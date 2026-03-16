/* ============================================
   Asset Tracker — Cloudflare Worker (Plaid Proxy)
   ============================================ */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function plaidHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
    'PLAID-SECRET': env.PLAID_SECRET,
  };
}

function plaidBase(env) {
  // Use 'sandbox' for testing, 'production' for live
  const plaidEnv = env.PLAID_ENV || 'sandbox';
  return `https://${plaidEnv}.plaid.com`;
}

async function plaidPost(env, path, body) {
  const res = await fetch(`${plaidBase(env)}${path}`, {
    method: 'POST',
    headers: plaidHeaders(env),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_message || `Plaid error: ${res.status}`);
  return data;
}

async function getItems(env) {
  const raw = await env.PLAID_ITEMS.get('items');
  return raw ? JSON.parse(raw) : [];
}

async function saveItems(env, items) {
  await env.PLAID_ITEMS.put('items', JSON.stringify(items));
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function checkAuth(request, env) {
  const key = request.headers.get('X-Api-Key');
  return key && key === env.WORKER_API_KEY;
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleLinkToken(request, env) {
  const data = await plaidPost(env, '/link/token/create', {
    user: { client_user_id: 'asset-tracker-user' },
    client_name: '资产总览',
    products: ['auth'],
    investments: {},
    additional_consented_products: ['investments'],
    country_codes: ['US'],
    language: 'en',
  });
  return json({ link_token: data.link_token });
}

async function handleExchange(request, env) {
  const body = await request.json();
  const { public_token, institution } = body;
  if (!public_token) return err('public_token required');

  const data = await plaidPost(env, '/item/public_token/exchange', { public_token });
  const { access_token, item_id } = data;

  const items = await getItems(env);
  // Remove existing entry for same item_id if re-linking
  const filtered = items.filter(i => i.item_id !== item_id);
  filtered.push({
    item_id,
    access_token,
    institution_name: institution?.name || 'Unknown',
    institution_id: institution?.institution_id || '',
    added_at: new Date().toISOString(),
  });
  await saveItems(env, filtered);

  return json({ item_id, institution_name: institution?.name || 'Unknown' });
}

async function handleGetAccounts(request, env) {
  const items = await getItems(env);
  const accounts = [];

  for (const item of items) {
    try {
      const data = await plaidPost(env, '/accounts/balance/get', {
        access_token: item.access_token,
      });
      for (const acct of data.accounts) {
        accounts.push({
          account_id: acct.account_id,
          item_id: item.item_id,
          institution_name: item.institution_name,
          name: acct.name,
          official_name: acct.official_name || acct.name,
          type: acct.type,
          subtype: acct.subtype,
          balance: acct.balances.current ?? acct.balances.available ?? 0,
          currency: (acct.balances.iso_currency_code || 'USD').toUpperCase(),
        });
      }
    } catch (e) {
      // Skip items that fail (e.g. expired tokens) but continue others
      accounts.push({
        account_id: null,
        item_id: item.item_id,
        institution_name: item.institution_name,
        error: e.message,
      });
    }
  }

  return json(accounts);
}

async function handleDeleteItem(itemId, env) {
  const items = await getItems(env);
  const item = items.find(i => i.item_id === itemId);

  if (item) {
    try {
      await plaidPost(env, '/item/remove', { access_token: item.access_token });
    } catch (_) {
      // Best-effort removal from Plaid; always remove from KV
    }
  }

  await saveItems(env, items.filter(i => i.item_id !== itemId));
  return json({ success: true });
}

async function handleListItems(env) {
  const items = await getItems(env);
  return json(items.map(({ item_id, institution_name, institution_id, added_at }) => ({
    item_id, institution_name, institution_id, added_at,
  })));
}

// ── Main fetch handler ────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Auth check for all non-OPTIONS requests
    if (!checkAuth(request, env)) {
      return err('Unauthorized', 401);
    }

    try {
      if (method === 'POST' && path === '/link-token') return handleLinkToken(request, env);
      if (method === 'POST' && path === '/exchange') return handleExchange(request, env);
      if (method === 'GET' && path === '/accounts') return handleGetAccounts(request, env);
      if (method === 'GET' && path === '/items') return handleListItems(env);
      if (method === 'DELETE' && path.startsWith('/item/')) {
        const itemId = path.slice('/item/'.length);
        return handleDeleteItem(itemId, env);
      }
      return err('Not found', 404);
    } catch (e) {
      return err(e.message, 500);
    }
  },
};
