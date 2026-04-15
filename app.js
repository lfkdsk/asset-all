/* ============================================
   Asset Tracker — App Logic
   ============================================ */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'asset_tracker_config';

const KNOWN_INSTITUTIONS = [
  // 中国商业银行
  '招商银行', '工商银行', '建设银行', '农业银行', '中国银行', '交通银行',
  '浦发银行', '中信银行', '光大银行', '民生银行', '平安银行', '兴业银行',
  '华夏银行', '广发银行', '北京银行', '上海银行', '宁波银行', '邮储银行',
  // 券商
  '华泰证券', '国泰君安', '中信证券', '海通证券', '招商证券', '广发证券',
  '东方证券', '申万宏源', '国信证券', '平安证券', '长江证券', '中金公司',
  // 国际银行 & 券商
  'Charles Schwab', 'Fidelity', 'Vanguard', 'Interactive Brokers',
  'TD Ameritrade', 'E*TRADE', 'Robinhood', 'Webull',
  'HSBC', 'Citibank', 'JPMorgan Chase', 'Bank of America', 'Wells Fargo',
  'DBS Bank', 'Standard Chartered', 'UBS', 'Credit Suisse',
  // 支付 & 理财
  '支付宝', '微信理财', '余额宝', '理财通', '京东金融', '蚂蚁财富',
];

const CATEGORY_COLORS = {
  '现金': 'var(--cat-cash)',
  '股票': 'var(--cat-stock)',
  '基金': 'var(--cat-fund)',
  '债券': 'var(--cat-bond)',
  '房产': 'var(--cat-property)',
  '其他': 'var(--cat-other)',
};

const CATEGORY_ICONS = {
  '现金': '💵',
  '股票': '📈',
  '基金': '📊',
  '债券': '🏦',
  '房产': '🏠',
  '其他': '💼',
};

// Maps lowercase keyword → domain for Clearbit logo lookup.
const INSTITUTION_DOMAINS = {
  // US Brokerages
  'robinhood':            'robinhood.com',
  'interactive brokers':  'interactivebrokers.com',
  'ibkr':                 'interactivebrokers.com',
  'charles schwab':       'schwab.com',
  'schwab':               'schwab.com',
  'fidelity':             'fidelity.com',
  'vanguard':             'vanguard.com',
  'td ameritrade':        'tdameritrade.com',
  'e*trade':              'etrade.com',
  'etrade':               'etrade.com',
  'webull':               'webull.com',
  // US Banks
  'jpmorgan':             'jpmorganchase.com',
  'chase':                'chase.com',
  'bank of america':      'bankofamerica.com',
  'wells fargo':          'wellsfargo.com',
  'citibank':             'citibank.com',
  'citi':                 'citi.com',
  'hsbc':                 'hsbc.com',
  'dbs bank':             'dbs.com',
  'standard chartered':   'sc.com',
  'ubs':                  'ubs.com',
  'credit suisse':        'credit-suisse.com',
  // Chinese Banks
  '招商银行':             'cmbchina.com',
  '工商银行':             'icbc.com.cn',
  '建设银行':             'ccb.com',
  '农业银行':             'abchina.com',
  '中国银行':             'boc.cn',
  '交通银行':             'bankcomm.com',
  '浦发银行':             'spdb.com.cn',
  '中信银行':             'citicbank.com',
  '光大银行':             'cebbank.com',
  '民生银行':             'cmbc.com.cn',
  '平安银行':             'bank.pingan.com',
  '兴业银行':             'cib.com.cn',
  '华夏银行':             'hxb.com.cn',
  '广发银行':             'cgbchina.com.cn',
  '北京银行':             'bankofbeijing.com.cn',
  '上海银行':             'bosc.cn',
  '宁波银行':             'nbcb.com.cn',
  '邮储银行':             'psbc.com',
  // Chinese Brokerages
  '华泰证券':             'htsc.com.cn',
  '国泰君安':             'gtja.com',
  '中信证券':             'cs.ecitic.com',
  '招商证券':             'csc108.com',
  '广发证券':             'gf.com.cn',
  '海通证券':             'htsec.com',
  // Payment / Wealth
  '支付宝':              'alipay.com',
  '微信':                'weixin.qq.com',
  '京东金融':            'jd.com',
  '蚂蚁财富':            'antgroup.com',
};

function getInstitutionDomain(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [key, domain] of Object.entries(INSTITUTION_DOMAINS)) {
    if (lower.includes(key.toLowerCase())) return domain;
  }
  return null;
}

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  config: null,           // { token, owner, repo, branch, baseCurrency }
  exchangeRates: null,    // { base, date, rates: {} }
  snapshotMeta: [],       // array of { name, sha, date, downloadUrl }
  snapshotIndex: [],      // lightweight manifest: [{date, totalInBase, baseCurrency, filename}]
  snapshotData: [],       // only the latest full snapshot (for items)
  currentItems: [],       // current working items (editable)
  savedItems: [],         // items from the latest saved snapshot
  isDirty: false,
  trendChart: null,
  chartRange: '1M',
  viewingSnapshot: null, // { date, items } when viewing a historical snapshot
  masked: false,         // hide all asset numbers
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(amount, currency) {
  if (state.masked) return '****';
  const fmt = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'JPY' || currency === 'KRW' || currency === 'IDR' ? 0 : 2,
    maximumFractionDigits: currency === 'JPY' || currency === 'KRW' || currency === 'IDR' ? 0 : 2,
  });
  try { return fmt.format(amount); } catch { return `${currency} ${amount.toFixed(2)}`; }
}

function formatAmountCompact(amount, currency) {
  if (state.masked) return '****';
  const abs = Math.abs(amount);
  let val = amount;
  let suffix = '';
  if (abs >= 1e8) { val = amount / 1e8; suffix = '亿'; }
  else if (abs >= 1e4) { val = amount / 1e4; suffix = '万'; }
  const decimals = suffix ? 2 : 0;
  const num = val.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${num}${suffix}`;
}

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), duration);
}

function setLoading(show) {
  document.getElementById('dashboard-loading').classList.toggle('hidden', !show);
  document.getElementById('dashboard-content').classList.toggle('hidden', show);
}

// ─── Config / LocalStorage ────────────────────────────────────────────────────

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  state.config = cfg;
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

const githubApi = {
  headers(token) {
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  },

  baseUrl(cfg) {
    return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
  },

  async listSnapshots(cfg) {
    const url = `${this.baseUrl(cfg)}/contents/snapshots`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (res.status === 404) return [];  // directory doesn't exist yet
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(f => /^\d{4}-\d{2}-\d{2}_/.test(f.name))
      .map(f => ({
        name: f.name,
        sha: f.sha,
        downloadUrl: f.download_url,
        date: f.name.slice(0, 10),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async fetchSnapshot(cfg, filename) {
    const url = `${this.baseUrl(cfg)}/contents/snapshots/${filename}`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (!res.ok) throw new Error(`Failed to fetch snapshot: ${res.status}`);
    const data = await res.json();
    return JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\s/g, '')))));
  },

  async saveSnapshot(cfg, snapshotJson) {
    const date = snapshotJson.snapshotDate;
    const filename = `${date}_${snapshotJson.id}.json`;
    const path = `snapshots/${filename}`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(snapshotJson, null, 2))));
    const url = `${this.baseUrl(cfg)}/contents/${path}`;
    const body = {
      message: `snapshot: ${date}`,
      content,
      branch: cfg.branch || 'main',
    };
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error: ${res.status}`);
    }
    return res.json();
  },

  async fetchIndex(cfg) {
    const url = `${this.baseUrl(cfg)}/contents/snapshots/index.json`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (res.status === 404) return [];
    if (!res.ok) return [];
    const data = await res.json();
    try {
      const json = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\s/g, '')))));
      return Array.isArray(json) ? json : [];
    } catch { return []; }
  },

  async saveIndex(cfg, indexData, existingSha) {
    const url = `${this.baseUrl(cfg)}/contents/snapshots/index.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(indexData, null, 2))));
    const body = {
      message: 'chore: update snapshot index',
      content,
      branch: cfg.branch || 'main',
    };
    if (existingSha) body.sha = existingSha;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Failed to update index.json:', err.message);
    }
  },

  async getIndexSha(cfg) {
    const url = `${this.baseUrl(cfg)}/contents/snapshots/index.json`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.sha || null;
  },

  async getFileMeta(cfg, path) {
    const url = `${this.baseUrl(cfg)}/contents/${path}`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (!res.ok) return null;
    return res.json();
  },

  async deleteFile(cfg, path, sha, message) {
    const url = `${this.baseUrl(cfg)}/contents/${path}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...this.headers(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha, branch: cfg.branch || 'main' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Delete failed: ${res.status}`);
    }
  },

  async moveToTrash(cfg, filename, content, sha) {
    // 1. Create file in trash/ folder
    const trashPath = `snapshots/trash/${filename}`;
    const trashUrl = `${this.baseUrl(cfg)}/contents/${trashPath}`;
    const putRes = await fetch(trashUrl, {
      method: 'PUT',
      headers: { ...this.headers(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `trash: ${filename}`,
        content,
        branch: cfg.branch || 'main',
      }),
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `Move to trash failed: ${putRes.status}`);
    }
    // 2. Delete original
    await this.deleteFile(cfg, `snapshots/${filename}`, sha, `remove: ${filename}`);
  },

  async updateFile(cfg, path, content, sha, message) {
    const url = `${this.baseUrl(cfg)}/contents/${path}`;
    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      sha,
      branch: cfg.branch || 'main',
    };
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(cfg.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Update failed: ${res.status}`);
    }
    return res.json();
  },

  async testConnection(cfg) {
    const url = `${this.baseUrl(cfg)}`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (!res.ok) throw new Error(`无法连接仓库 (${res.status})`);
    return res.json();
  },
};

// ─── Exchange Rate API ────────────────────────────────────────────────────────

const fxApi = {
  async fetchRates(baseCurrency, date) {
    const endpoint = date ? date : 'latest';
    const url = `https://api.frankfurter.dev/v1/${endpoint}?base=${baseCurrency}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch exchange rates');
    const data = await res.json();
    // Add base currency itself with rate 1
    data.rates[baseCurrency] = 1;
    return data;
  },

  convert(amount, fromCurrency, toCurrency, rates) {
    if (fromCurrency === toCurrency) return amount;
    // rates are relative to base
    const base = rates.base;
    if (fromCurrency === base) return amount * (rates.rates[toCurrency] || 1);
    if (toCurrency === base) return amount / (rates.rates[fromCurrency] || 1);
    // cross rate
    const toBase = amount / (rates.rates[fromCurrency] || 1);
    return toBase * (rates.rates[toCurrency] || 1);
  },

  getRate(fromCurrency, toBase, rates) {
    if (fromCurrency === rates.base) return 1;
    return rates.rates[fromCurrency] ? (1 / rates.rates[fromCurrency]) : 1;
  },
};

// ─── Local Cache ──────────────────────────────────────────────────────────────

const CACHE_KEY = 'asset_tracker_cache';

function saveLocalCache(items, snapshotIndex, baseCurrency) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      items,
      snapshotIndex,
      baseCurrency,
      cachedAt: new Date().toISOString(),
    }));
  } catch (_) { /* storage full or unavailable — ignore */ }
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Snapshot Builder ─────────────────────────────────────────────────────────

function buildSnapshot(items, baseCurrency, exchangeRates) {
  const processedItems = items.map(item => {
    const fxRate = item.currency === baseCurrency
      ? 1
      : (exchangeRates ? (1 / (exchangeRates.rates[item.currency] || 1)) : 1);
    const valueInBase = item.amount * fxRate;
    return {
      assetId: item.assetId,
      assetName: item.assetName,
      category: item.category,
      currency: item.currency,
      amount: item.amount,
      notes: item.notes || '',
      fxRateToBase: fxRate,
      valueInBase,
    };
  });

  const totalInBase = processedItems.reduce((sum, i) => sum + i.valueInBase, 0);

  return {
    version: 1,
    id: uuid(),
    snapshotDate: today(),
    createdAt: new Date().toISOString(),
    baseCurrency,
    items: processedItems,
    totalInBase,
  };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderTotalCard() {
  const { currentItems, exchangeRates, config, viewingSnapshot } = state;
  if (!config) return;

  const base = config.baseCurrency;
  const isHistorical = !!viewingSnapshot;
  let total = 0;

  if (isHistorical) {
    // Sum from snapshot items' valueInBase, convert if baseCurrency differs
    const snapBase = viewingSnapshot.baseCurrency;
    const rawTotal = viewingSnapshot.items.reduce((sum, i) => sum + (i.valueInBase ?? i.amount), 0);
    if (snapBase !== base && exchangeRates) {
      const toExBase = rawTotal / (exchangeRates.rates[snapBase] || 1);
      total = toExBase * (exchangeRates.rates[base] || 1);
    } else {
      total = rawTotal;
    }
  } else if (exchangeRates) {
    total = currentItems.reduce((sum, item) => {
      const val = item.currency === base
        ? item.amount
        : item.amount / (exchangeRates.rates[item.currency] || 1);
      return sum + val;
    }, 0);
  }

  document.getElementById('total-amount').textContent = formatAmountCompact(total, base);
  document.getElementById('total-currency-badge').textContent = base;

  // USD auxiliary display (when base ≠ USD)
  const usdEl = document.getElementById('total-usd');
  if (usdEl) {
    if (exchangeRates && base !== 'USD' && total > 0) {
      const usdRate = exchangeRates.rates['USD'];
      if (usdRate) {
        const totalUsd = base === exchangeRates.base
          ? total * usdRate
          : total / (exchangeRates.rates[base] || 1) * usdRate;
        usdEl.textContent = state.masked ? '≈ ****' : `≈ ${formatAmount(totalUsd, 'USD')}`;
      } else {
        usdEl.textContent = '';
      }
    } else {
      usdEl.textContent = '';
    }
  }

  // Change vs previous snapshot
  const changeEl = document.getElementById('total-change');
  if (isHistorical) {
    // Show snapshot date instead of diff
    changeEl.textContent = `快照：${viewingSnapshot.date}`;
    changeEl.className = 'total-change';
  } else if (state.snapshotIndex.length >= 2) {
    const prev = state.snapshotIndex[state.snapshotIndex.length - 2];
    let prevTotal = prev.totalInBase || 0;
    if (exchangeRates && prev.baseCurrency && prev.baseCurrency !== base) {
      if (prev.baseCurrency === exchangeRates.base) {
        prevTotal = prev.totalInBase * (exchangeRates.rates[base] || 1);
      } else {
        const toExBase = prev.totalInBase / (exchangeRates.rates[prev.baseCurrency] || 1);
        prevTotal = toExBase * (exchangeRates.rates[base] || 1);
      }
    }
    const diff = total - prevTotal;
    const pct = prevTotal > 0 ? ((diff / prevTotal) * 100).toFixed(2) : 0;
    const sign = diff >= 0 ? '+' : '';
    changeEl.textContent = state.masked ? '****' : `${sign}${formatAmountCompact(diff, base)} (${sign}${pct}%)`;
    changeEl.className = `total-change ${diff >= 0 ? 'positive' : 'negative'}`;
  } else {
    changeEl.textContent = '';
  }

  const dateEl = document.getElementById('total-date');
  const fxTooltip = document.getElementById('fx-tooltip');
  if (isHistorical) {
    dateEl.textContent = `快照日期：${viewingSnapshot.date}`;
    fxTooltip.classList.add('hidden');
    fxTooltip.innerHTML = '';
  } else {
    dateEl.textContent = exchangeRates ? `汇率更新：${exchangeRates.date}` : '';
    // Build FX tooltip content: show rates for currencies held by user
    if (exchangeRates) {
      const heldCurrencies = [...new Set(currentItems.map(i => i.currency))].filter(c => c !== base).sort();
      if (heldCurrencies.length > 0) {
        fxTooltip.innerHTML = heldCurrencies.map(c => {
          const rate = 1 / (exchangeRates.rates[c] || 1);
          return `<div>1 ${c} = ${rate.toFixed(4)} ${base}</div>`;
        }).join('');
      } else {
        fxTooltip.innerHTML = '';
        fxTooltip.classList.add('hidden');
      }
    }
  }
}

function renderAssetList() {
  const { currentItems, exchangeRates, config, viewingSnapshot } = state;
  const listEl = document.getElementById('asset-list');
  const emptyEl = document.getElementById('asset-list-empty');

  // Determine which items to show
  const isHistorical = !!viewingSnapshot;
  const items = isHistorical ? viewingSnapshot.items : currentItems;
  const base = isHistorical
    ? (config ? config.baseCurrency : viewingSnapshot.baseCurrency)
    : (config ? config.baseCurrency : 'CNY');

  if (items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = items.map(item => {
    const category = item.category || '其他';
    const color = CATEGORY_COLORS[category] || CATEGORY_COLORS['其他'];
    const fallback = CATEGORY_ICONS[category] || '💼';
    const domain = getInstitutionDomain(item.assetName);
    const iconHtml = domain
      ? `<img class="asset-logo" src="https://icon.horse/icon/${domain}" alt="" onerror="this.outerHTML='<span>${fallback}</span>'">`
      : `<span>${fallback}</span>`;

    let valueInBase;
    if (isHistorical) {
      valueInBase = item.valueInBase ?? item.amount;
    } else {
      valueInBase = item.amount;
      if (exchangeRates && item.currency !== base) {
        valueInBase = item.amount / (exchangeRates.rates[item.currency] || 1);
      }
    }
    const showOrig = item.currency !== base;
    return `
      <div class="asset-item ${isHistorical ? 'asset-item-readonly' : ''}" data-id="${item.assetId}">
        <div class="asset-icon" style="background:${color}22;">
          ${iconHtml}
        </div>
        <div class="asset-info">
          <div class="asset-name">${escHtml(item.assetName)}</div>
          <div class="asset-meta">${escHtml(category)}${item.notes ? ' · ' + escHtml(item.notes) : ''}</div>
        </div>
        <div class="asset-amounts">
          <div class="asset-value-base">${formatAmount(valueInBase, base)}</div>
          ${showOrig ? `<div class="asset-value-orig">${formatAmount(item.amount, item.currency)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // Only bind click-to-edit for current items, not historical view
  if (!isHistorical) {
    listEl.querySelectorAll('.asset-item').forEach(el => {
      el.addEventListener('click', () => openEditModal(el.dataset.id));
    });
  }
}

async function loadSnapshotView(entry) {
  if (!state.config) return;
  const banner = document.getElementById('snapshot-view-banner');
  const dateEl = document.getElementById('snapshot-view-date');

  dateEl.textContent = `加载 ${entry.date}...`;
  banner.classList.remove('hidden');

  try {
    const snapshot = await githubApi.fetchSnapshot(state.config, entry.filename);
    state.viewingSnapshot = { date: entry.date, items: snapshot.items, baseCurrency: snapshot.baseCurrency };
    dateEl.textContent = `查看快照：${entry.date}`;
    renderTotalCard();
    renderAssetList();
  } catch (err) {
    showToast(`加载失败：${err.message}`, 3000);
    banner.classList.add('hidden');
  }
}

function exitSnapshotView() {
  state.viewingSnapshot = null;
  document.getElementById('snapshot-view-banner').classList.add('hidden');
  renderTotalCard();
  renderAssetList();
}

function getRangeCutoff(range) {
  const now = new Date();
  switch (range) {
    case '1M': return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().slice(0, 10);
    case '3M': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().slice(0, 10);
    case '6M': return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString().slice(0, 10);
    case '1Y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
    case '3Y': return new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
    default: return null;
  }
}

function renderTrendChart() {
  const { snapshotIndex, exchangeRates, config, chartRange } = state;
  const base = config ? config.baseCurrency : 'CNY';

  const noDataEl = document.getElementById('chart-no-data');
  const periodChangeEl = document.getElementById('chart-period-change');

  if (snapshotIndex.length < 1) {
    noDataEl.classList.remove('hidden');
    periodChangeEl.classList.add('hidden');
    return;
  }
  noDataEl.classList.add('hidden');

  // Filter by range
  const cutoff = getRangeCutoff(chartRange);
  const filtered = cutoff
    ? snapshotIndex.filter(e => e.date >= cutoff)
    : snapshotIndex;
  const data = filtered.length > 0 ? filtered : snapshotIndex;

  // Convert totals to current base currency
  function convertTotal(entry) {
    let total = entry.totalInBase;
    if (exchangeRates && entry.baseCurrency && entry.baseCurrency !== base) {
      if (entry.baseCurrency === exchangeRates.base) {
        total = entry.totalInBase * (exchangeRates.rates[base] || 1);
      } else {
        const toExBase = entry.totalInBase / (exchangeRates.rates[entry.baseCurrency] || 1);
        total = toExBase * (exchangeRates.rates[base] || 1);
      }
    }
    return total;
  }

  const labels = [];
  const values = [];
  const firstYear = data[0].date.slice(0, 4);
  const multiYear = data.some(e => e.date.slice(0, 4) !== firstYear);

  for (const entry of data) {
    labels.push(multiYear ? entry.date.slice(2) : entry.date.slice(5));
    values.push(convertTotal(entry));
  }

  // Period change display — use raw totalInBase from snapshots to show true asset change
  if (data.length >= 2) {
    const firstEntry = data[0];
    const lastEntry = data[data.length - 1];
    // Use raw totalInBase; only convert if base currencies differ between entries
    let firstVal = firstEntry.totalInBase;
    let lastVal = lastEntry.totalInBase;
    if (firstEntry.baseCurrency !== lastEntry.baseCurrency && exchangeRates) {
      // Normalize both to current base
      firstVal = convertTotal(firstEntry);
      lastVal = convertTotal(lastEntry);
    }
    const diff = lastVal - firstVal;
    const pct = firstVal > 0 ? ((diff / firstVal) * 100).toFixed(2) : 0;
    const sign = diff >= 0 ? '+' : '';
    const arrow = diff >= 0 ? '▲' : '▼';
    periodChangeEl.textContent = `${arrow} ${sign}${formatAmountCompact(diff, base)} (${sign}${pct}%)`;
    periodChangeEl.className = `chart-period-change ${diff >= 0 ? 'positive' : 'negative'}`;
    periodChangeEl.classList.remove('hidden');
  } else {
    periodChangeEl.classList.add('hidden');
  }

  // Color based on trend
  const isPositive = values.length < 2 || values[values.length - 1] >= values[0];
  const lineColor = isPositive ? '#34C759' : '#FF453A';
  const gradientTop = isPositive ? 'rgba(52,199,89,0.25)' : 'rgba(255,69,58,0.25)';

  const canvas = document.getElementById('trend-chart');
  const ctx = canvas.getContext('2d');

  if (state.trendChart) {
    state.trendChart.destroy();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 160);
  gradient.addColorStop(0, gradientTop);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  // Store filtered data for click handler
  state._chartData = data;

  state.trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: lineColor,
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: lineColor,
        pointBorderColor: 'transparent',
        pointHoverRadius: 6,
        pointHoverBackgroundColor: lineColor,
        pointHoverBorderColor: '#1C1C1E',
        pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick(evt, elements) {
        if (elements.length > 0) {
          const idx = elements[0].index;
          const entry = state._chartData[idx];
          if (entry) loadSnapshotView(entry);
        }
      },
      onHover(evt, elements) {
        evt.native.target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(44,44,46,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: 'rgba(235,235,245,0.6)',
          bodyColor: '#FFFFFF',
          padding: 10,
          callbacks: {
            label: c => formatAmount(c.raw, base),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: 'rgba(235,235,245,0.4)', font: { size: 11 }, maxTicksLimit: 6 },
          border: { display: false },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: 'rgba(235,235,245,0.4)',
            font: { size: 11 },
            callback: v => formatAmountCompact(v, base),
          },
          border: { display: false },
        },
      },
    },
  });
}

function renderSaveButton() {
  const btn = document.getElementById('btn-save-snapshot');
  btn.disabled = !state.isDirty;
  document.getElementById('btn-save-text').textContent = state.isDirty ? '保存快照' : '已是最新';
}

function renderAll() {
  renderTotalCard();
  renderAssetList();

  renderTrendChart();
  renderSaveButton();
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  setLoading(true);
  try {
    // Parallel: fetch snapshot list, exchange rates, and index.json manifest
    const [snapshotMeta, rates, snapshotIndex] = await Promise.all([
      githubApi.listSnapshots(state.config),
      fxApi.fetchRates(state.config.baseCurrency),
      githubApi.fetchIndex(state.config),
    ]);

    state.snapshotMeta = snapshotMeta;
    state.exchangeRates = rates;
    state.snapshotIndex = snapshotIndex;

    // Update FX date in settings
    const fxDateEl = document.getElementById('fx-rate-date');
    if (fxDateEl) fxDateEl.textContent = `汇率日期：${rates.date}`;

    // Load only the latest full snapshot (for current items)
    if (snapshotMeta.length > 0) {
      const latest = snapshotMeta[snapshotMeta.length - 1];
      const latestSnapshot = await githubApi.fetchSnapshot(state.config, latest.name);
      state.snapshotData = [latestSnapshot];
      state.currentItems = latestSnapshot.items.map(i => ({ ...i }));
      state.savedItems = latestSnapshot.items.map(i => ({ ...i }));
    } else {
      state.snapshotData = [];
      state.currentItems = [];
      state.savedItems = [];
    }
    state.isDirty = false;

    // Save to local cache for fast next load
    saveLocalCache(state.currentItems, state.snapshotIndex, state.config.baseCurrency);

    setLoading(false);
    renderAll();
  } catch (err) {
    setLoading(false);
    showToast(`加载失败：${err.message}`, 4000);
    console.error(err);
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function markDirty() {
  state.isDirty = true;
  renderSaveButton();
}

function addItem(data) {
  state.currentItems.push({ ...data, assetId: uuid() });
  markDirty();
  renderAssetList();

  renderTotalCard();
}

function updateItem(assetId, data) {
  const idx = state.currentItems.findIndex(i => i.assetId === assetId);
  if (idx !== -1) {
    state.currentItems[idx] = { ...state.currentItems[idx], ...data };
    markDirty();
    renderAssetList();
  
    renderTotalCard();
  }
}

function deleteItem(assetId) {
  state.currentItems = state.currentItems.filter(i => i.assetId !== assetId);
  markDirty();
  renderAssetList();

  renderTotalCard();
}

async function saveSnapshot() {
  const btn = document.getElementById('btn-save-snapshot');
  const textEl = document.getElementById('btn-save-text');
  btn.disabled = true;
  textEl.textContent = '保存中...';

  try {
    const snapshot = buildSnapshot(state.currentItems, state.config.baseCurrency, state.exchangeRates);
    const filename = `${snapshot.snapshotDate}_${snapshot.id}.json`;

    // Save snapshot + get current index SHA in parallel
    const [, indexSha] = await Promise.all([
      githubApi.saveSnapshot(state.config, snapshot),
      githubApi.getIndexSha(state.config),
    ]);

    // Update lightweight index.json manifest
    const newEntry = {
      date: snapshot.snapshotDate,
      totalInBase: snapshot.totalInBase,
      baseCurrency: snapshot.baseCurrency,
      filename,
    };
    const updatedIndex = [...state.snapshotIndex, newEntry];
    await githubApi.saveIndex(state.config, updatedIndex, indexSha);

    state.snapshotIndex = updatedIndex;
    state.savedItems = state.currentItems.map(i => ({ ...i }));
    state.snapshotData = [snapshot];
    state.isDirty = false;

    // Keep local cache in sync
    saveLocalCache(state.currentItems, state.snapshotIndex, state.config.baseCurrency);

    showToast('快照已保存 ✓');
    renderAll();
  } catch (err) {
    showToast(`保存失败：${err.message}`, 4000);
    btn.disabled = false;
    textEl.textContent = '保存快照';
    console.error(err);
  }
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function openAddModal() {
  const modal = document.getElementById('modal-item');
  document.getElementById('modal-item-title').textContent = '添加资产';
  document.getElementById('item-id').value = '';
  document.getElementById('item-name').value = '';
  document.getElementById('item-category').value = '现金';
  document.getElementById('item-currency').value = state.config?.baseCurrency || 'CNY';
  document.getElementById('item-amount').value = '';
  document.getElementById('item-notes').value = '';
  document.getElementById('btn-item-delete').classList.add('hidden');
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('item-name').focus(), 100);
}

function openEditModal(assetId) {
  const item = state.currentItems.find(i => i.assetId === assetId);
  if (!item) return;
  const modal = document.getElementById('modal-item');
  document.getElementById('modal-item-title').textContent = '编辑资产';
  document.getElementById('item-id').value = item.assetId;
  document.getElementById('item-name').value = item.assetName;
  document.getElementById('item-category').value = item.category;
  document.getElementById('item-currency').value = item.currency;
  document.getElementById('item-amount').value = item.amount;
  document.getElementById('item-notes').value = item.notes || '';
  document.getElementById('btn-item-delete').classList.remove('hidden');
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-item').classList.add('hidden');
  document.getElementById('autocomplete-list').classList.add('hidden');
}

function openSettings() {
  const cfg = state.config || {};
  document.getElementById('settings-token').value = cfg.token || '';
  document.getElementById('settings-owner').value = cfg.owner || '';
  document.getElementById('settings-repo').value = cfg.repo || '';
  document.getElementById('settings-branch').value = cfg.branch || 'main';
  document.getElementById('settings-currency').value = cfg.baseCurrency || 'CNY';
  document.getElementById('settings-error').classList.add('hidden');
  document.getElementById('panel-settings').classList.remove('hidden');

  // FX date
  const fxDateEl = document.getElementById('fx-rate-date');
  if (fxDateEl && state.exchangeRates) {
    fxDateEl.textContent = `汇率日期：${state.exchangeRates.date}`;
  }

  // Render snapshot management list
  renderSnapshotManageList();
}

function closeSettings() {
  document.getElementById('panel-settings').classList.add('hidden');
}

// ─── Autocomplete ─────────────────────────────────────────────────────────────

function setupAutocomplete() {
  const input = document.getElementById('item-name');
  const list = document.getElementById('autocomplete-list');

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val) { list.classList.add('hidden'); return; }

    const matches = KNOWN_INSTITUTIONS.filter(name =>
      name.toLowerCase().includes(val)
    ).slice(0, 8);

    if (matches.length === 0) { list.classList.add('hidden'); return; }

    list.innerHTML = matches.map(name =>
      `<div class="autocomplete-item">${escHtml(name)}</div>`
    ).join('');
    list.classList.remove('hidden');

    list.querySelectorAll('.autocomplete-item').forEach((el, i) => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = matches[i];
        list.classList.add('hidden');
      });
    });
  });

  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('hidden'), 150);
  });
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

function showSetup() {
  document.getElementById('screen-setup').classList.remove('hidden');
  document.getElementById('screen-dashboard').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('screen-setup').classList.add('hidden');
  document.getElementById('screen-dashboard').classList.remove('hidden');
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function toggleMask() {
  state.masked = !state.masked;
  document.getElementById('btn-toggle-mask').classList.toggle('masked', state.masked);
  renderAll();
}

function bindEvents() {
  // Mask toggle
  document.getElementById('btn-toggle-mask').addEventListener('click', toggleMask);

  // Setup form
  document.getElementById('form-setup').addEventListener('submit', async e => {
    e.preventDefault();
    const cfg = {
      token: document.getElementById('setup-token').value.trim(),
      owner: document.getElementById('setup-owner').value.trim(),
      repo: document.getElementById('setup-repo').value.trim(),
      branch: document.getElementById('setup-branch').value.trim() || 'main',
      baseCurrency: document.getElementById('setup-currency').value,
    };
    const errEl = document.getElementById('setup-error');
    const btnText = document.querySelector('#btn-setup-save .btn-text');
    const btnLoading = document.querySelector('#btn-setup-save .btn-loading');
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
    errEl.classList.add('hidden');

    try {
      await githubApi.testConnection(cfg);
      saveConfig(cfg);
      showDashboard();
      await loadData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btnText.classList.remove('hidden');
      btnLoading.classList.add('hidden');
    }
  });

  // Header buttons
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    showToast('刷新中...');
    await loadData();
  });

  // Chart range buttons
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartRange = btn.dataset.range;
      renderTrendChart();
    });
  });

  // Save snapshot
  document.getElementById('btn-save-snapshot').addEventListener('click', saveSnapshot);

  // Add item buttons
  document.getElementById('btn-add-item').addEventListener('click', openAddModal);
  document.getElementById('btn-add-first').addEventListener('click', openAddModal);

  // Item modal close
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('item-modal-overlay').addEventListener('click', closeModal);

  // Item form submit
  document.getElementById('form-item').addEventListener('submit', e => {
    e.preventDefault();
    const assetId = document.getElementById('item-id').value;
    const data = {
      assetName: document.getElementById('item-name').value.trim(),
      category: document.getElementById('item-category').value,
      currency: document.getElementById('item-currency').value,
      amount: parseFloat(document.getElementById('item-amount').value) || 0,
      notes: document.getElementById('item-notes').value.trim(),
    };
    if (!data.assetName) return;

    if (assetId) {
      updateItem(assetId, data);
    } else {
      addItem(data);
    }
    closeModal();
  });

  // Delete item
  document.getElementById('btn-item-delete').addEventListener('click', () => {
    const assetId = document.getElementById('item-id').value;
    if (!assetId) return;
    if (confirm(`确定删除「${document.getElementById('item-name').value}」？`)) {
      deleteItem(assetId);
      closeModal();
    }
  });

  // Settings close
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  // Force update PWA
  document.getElementById('btn-force-update').addEventListener('click', async () => {
    const statusEl = document.getElementById('update-status');
    statusEl.textContent = '正在更新...';
    statusEl.classList.remove('hidden');
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      statusEl.textContent = '缓存已清除，正在重新加载...';
      setTimeout(() => location.reload(true), 500);
    } catch (err) {
      statusEl.textContent = `更新失败：${err.message}`;
    }
  });

  // Settings currency change (live update)
  document.getElementById('settings-currency').addEventListener('change', async e => {
    const newBase = e.target.value;
    if (state.config && newBase !== state.config.baseCurrency) {
      state.config.baseCurrency = newBase;
      saveConfig(state.config);
      try {
        state.exchangeRates = await fxApi.fetchRates(newBase);
        renderAll();
      } catch (err) {
        showToast('汇率更新失败');
      }
    }
  });

  // Settings save (GitHub config)
  document.getElementById('btn-settings-save').addEventListener('click', async () => {
    const cfg = {
      token: document.getElementById('settings-token').value.trim(),
      owner: document.getElementById('settings-owner').value.trim(),
      repo: document.getElementById('settings-repo').value.trim(),
      branch: document.getElementById('settings-branch').value.trim() || 'main',
      baseCurrency: document.getElementById('settings-currency').value,
    };
    const errEl = document.getElementById('settings-error');
    errEl.classList.add('hidden');

    try {
      await githubApi.testConnection(cfg);
      saveConfig(cfg);
      closeSettings();
      showToast('配置已保存，重新加载数据...');
      await loadData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  // FX tooltip toggle
  document.getElementById('total-date').addEventListener('click', () => {
    const tip = document.getElementById('fx-tooltip');
    if (tip.innerHTML) tip.classList.toggle('hidden');
  });

  // Snapshot view back button
  document.getElementById('btn-snapshot-back').addEventListener('click', exitSnapshotView);

  // Historical snapshot panel & FX fix
  document.getElementById('btn-open-history').addEventListener('click', openHistoryPanel);
  document.getElementById('btn-fix-fx').addEventListener('click', fixHistoricalFx);
  document.getElementById('btn-close-history').addEventListener('click', closeHistoryPanel);
  document.getElementById('history-overlay').addEventListener('click', closeHistoryPanel);
  document.getElementById('btn-history-add-item').addEventListener('click', addHistoryRow);
  document.getElementById('btn-save-history').addEventListener('click', saveHistoricalSnapshot);

  // Setup autocomplete
  setupAutocomplete();
}

// ─── Historical Snapshot ─────────────────────────────────────────────────────

let historyItems = []; // temp items for the history panel

function openHistoryPanel() {
  const panel = document.getElementById('panel-history');
  panel.classList.remove('hidden');
  document.getElementById('history-date').value = '';
  document.getElementById('history-error').classList.add('hidden');
  // Pre-populate with current asset list as a starting point
  historyItems = state.currentItems.map(item => ({
    assetName: item.assetName,
    currency: item.currency,
    amount: 0,
  }));
  if (historyItems.length === 0) addHistoryRow();
  renderHistoryItems();
}

function closeHistoryPanel() {
  document.getElementById('panel-history').classList.add('hidden');
}

function addHistoryRow() {
  historyItems.push({ assetName: '', currency: state.config?.baseCurrency || 'CNY', amount: 0 });
  renderHistoryItems();
}

function removeHistoryRow(idx) {
  historyItems.splice(idx, 1);
  renderHistoryItems();
}

function renderHistoryItems() {
  const list = document.getElementById('history-items-list');
  const baseCurrency = state.config?.baseCurrency || 'CNY';
  const currencies = ['CNY','USD','EUR','HKD','JPY','GBP','SGD','AUD','CAD','CHF'];

  list.innerHTML = historyItems.map((item, i) => `
    <div class="history-item-row">
      <input type="text" placeholder="资产名称" value="${escHtml(item.assetName)}" data-idx="${i}" data-field="assetName">
      <select data-idx="${i}" data-field="currency">
        ${currencies.map(c => `<option value="${c}" ${c === item.currency ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <input type="number" placeholder="金额" step="0.01" min="0" value="${item.amount || ''}" data-idx="${i}" data-field="amount">
      <button type="button" class="btn-remove-row" data-idx="${i}">&times;</button>
    </div>
  `).join('');

  // Bind input changes
  list.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.idx);
      const field = el.dataset.field;
      historyItems[idx][field] = field === 'amount' ? (parseFloat(el.value) || 0) : el.value;
      updateHistoryTotal();
    });
  });

  // Bind remove buttons
  list.querySelectorAll('.btn-remove-row').forEach(btn => {
    btn.addEventListener('click', () => removeHistoryRow(parseInt(btn.dataset.idx)));
  });

  updateHistoryTotal();
}

function updateHistoryTotal() {
  const base = state.config?.baseCurrency || 'CNY';
  let total = 0;
  for (const item of historyItems) {
    if (item.currency === base) {
      total += item.amount;
    } else if (state.exchangeRates) {
      total += item.amount / (state.exchangeRates.rates[item.currency] || 1);
    }
  }
  const el = document.getElementById('history-total');
  const count = historyItems.filter(i => i.assetName && i.amount > 0).length;
  const hasMultiCurrency = new Set(historyItems.map(i => i.currency)).size > 1;
  el.textContent = `共 ${count} 项 · 合计 ${formatAmountCompact(total, base)}` +
    (hasMultiCurrency ? '（保存时将使用历史汇率）' : '');
}

async function saveHistoricalSnapshot() {
  const dateInput = document.getElementById('history-date');
  const btn = document.getElementById('btn-save-history');
  const textEl = document.getElementById('btn-history-text');
  const errEl = document.getElementById('history-error');
  errEl.classList.add('hidden');

  const dateStr = dateInput.value;
  if (!dateStr) { errEl.textContent = '请选择日期'; errEl.classList.remove('hidden'); return; }
  if (dateStr > today()) { errEl.textContent = '不能选择未来日期'; errEl.classList.remove('hidden'); return; }
  if (!state.config) { errEl.textContent = '请先配置 GitHub'; errEl.classList.remove('hidden'); return; }

  // Filter valid items
  const validItems = historyItems.filter(i => i.assetName.trim() && i.amount > 0);
  if (validItems.length === 0) { errEl.textContent = '请至少添加一条资产'; errEl.classList.remove('hidden'); return; }

  if (state.snapshotIndex.some(e => e.date === dateStr)) {
    errEl.textContent = `${dateStr} 已存在快照`;
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  textEl.textContent = '拉取历史汇率...';

  try {
    const base = state.config.baseCurrency;

    // Fetch historical exchange rates for the specified date
    const historicalRates = await fxApi.fetchRates(base, dateStr);

    textEl.textContent = '保存中...';

    const processedItems = validItems.map(item => {
      const fxRate = item.currency === base
        ? 1
        : (1 / (historicalRates.rates[item.currency] || 1));
      return {
        assetId: uuid(),
        assetName: item.assetName.trim(),
        category: '其他',
        currency: item.currency,
        amount: item.amount,
        notes: '',
        fxRateToBase: fxRate,
        valueInBase: item.amount * fxRate,
      };
    });

    const totalInBase = processedItems.reduce((sum, i) => sum + i.valueInBase, 0);
    const snapshot = {
      version: 1,
      id: uuid(),
      snapshotDate: dateStr,
      createdAt: new Date().toISOString(),
      baseCurrency: base,
      fxDate: historicalRates.date,
      items: processedItems,
      totalInBase,
    };
    const filename = `${dateStr}_${snapshot.id}.json`;

    const [, indexSha] = await Promise.all([
      githubApi.saveSnapshot(state.config, snapshot),
      githubApi.getIndexSha(state.config),
    ]);

    const newEntry = { date: dateStr, totalInBase, baseCurrency: base, filename };
    const updatedIndex = [...state.snapshotIndex, newEntry]
      .sort((a, b) => a.date.localeCompare(b.date));
    await githubApi.saveIndex(state.config, updatedIndex, indexSha);

    state.snapshotIndex = updatedIndex;
    saveLocalCache(state.currentItems, state.snapshotIndex, state.config.baseCurrency);

    closeHistoryPanel();
    showToast(`历史快照 ${dateStr} 已保存 ✓`);
    renderAll();
  } catch (err) {
    errEl.textContent = `保存失败：${err.message}`;
    errEl.classList.remove('hidden');
    console.error(err);
  } finally {
    btn.disabled = false;
    textEl.textContent = '保存快照';
  }
}

// ─── Snapshot Management ─────────────────────────────────────────────────────

function renderSnapshotManageList() {
  const container = document.getElementById('snapshot-manage-list');
  const index = state.snapshotIndex;
  const base = state.config?.baseCurrency || 'CNY';

  if (!index || index.length === 0) {
    container.innerHTML = '<p class="snapshot-manage-empty">暂无快照</p>';
    return;
  }

  container.innerHTML = index.map((entry, i) => `
    <div class="snapshot-manage-row">
      <div class="snapshot-manage-info">
        <span class="snapshot-manage-date">${escHtml(entry.date)}</span>
        <span class="snapshot-manage-total">${formatAmountCompact(entry.totalInBase, entry.baseCurrency || base)}</span>
      </div>
      <button class="btn-trash" data-idx="${i}" data-filename="${escHtml(entry.filename)}" data-date="${escHtml(entry.date)}">删除</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-trash').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteSnapshot(btn));
  });
}

async function handleDeleteSnapshot(btn) {
  const filename = btn.dataset.filename;
  const date = btn.dataset.date;
  if (!confirm(`确定删除 ${date} 的快照？\n文件会移至 trash 文件夹`)) return;

  btn.disabled = true;
  btn.textContent = '删除中...';

  try {
    // Get file metadata (need sha and content)
    const meta = await githubApi.getFileMeta(state.config, `snapshots/${filename}`);
    if (!meta) throw new Error('快照文件不存在');

    // Move to trash (copy content, then delete original)
    await githubApi.moveToTrash(state.config, filename, meta.content.replace(/\s/g, ''), meta.sha);

    // Update index
    const updatedIndex = state.snapshotIndex.filter(e => e.filename !== filename);
    const indexSha = await githubApi.getIndexSha(state.config);
    await githubApi.saveIndex(state.config, updatedIndex, indexSha);

    state.snapshotIndex = updatedIndex;
    saveLocalCache(state.currentItems, state.snapshotIndex, state.config.baseCurrency);

    showToast(`快照 ${date} 已移至回收站 ✓`);
    renderSnapshotManageList();
    renderAll();
  } catch (err) {
    showToast(`删除失败：${err.message}`, 4000);
    btn.disabled = false;
    btn.textContent = '删除';
    console.error(err);
  }
}

async function fixHistoricalFx() {
  const btn = document.getElementById('btn-fix-fx');
  const textEl = document.getElementById('btn-fix-fx-text');
  const progressEl = document.getElementById('fix-fx-progress');

  if (!state.config) { showToast('请先配置 GitHub'); return; }
  const index = state.snapshotIndex;
  if (!index || index.length === 0) { showToast('没有快照需要矫正'); return; }
  if (!confirm(`将对 ${index.length} 个快照重新拉取历史汇率并更新，确定继续？`)) return;

  btn.disabled = true;
  progressEl.classList.remove('hidden');
  const updatedIndex = [];

  try {
    for (let i = 0; i < index.length; i++) {
      const entry = index[i];
      progressEl.textContent = `(${i + 1}/${index.length}) 处理 ${entry.date}...`;
      textEl.textContent = `矫正中 ${i + 1}/${index.length}`;

      // 1. Fetch the snapshot file
      const meta = await githubApi.getFileMeta(state.config, `snapshots/${entry.filename}`);
      if (!meta) {
        updatedIndex.push(entry);
        continue;
      }
      const snapshot = JSON.parse(decodeURIComponent(escape(atob(meta.content.replace(/\s/g, '')))));

      // 2. Fetch historical rates for that date
      const base = snapshot.baseCurrency;
      const historicalRates = await fxApi.fetchRates(base, entry.date);

      // 3. Recalculate each item
      let changed = false;
      for (const item of snapshot.items) {
        const newRate = item.currency === base
          ? 1
          : (1 / (historicalRates.rates[item.currency] || 1));
        const newValue = item.amount * newRate;
        if (Math.abs(newRate - (item.fxRateToBase || 1)) > 1e-8) {
          changed = true;
        }
        item.fxRateToBase = newRate;
        item.valueInBase = newValue;
      }

      if (changed) {
        snapshot.totalInBase = snapshot.items.reduce((sum, it) => sum + it.valueInBase, 0);
        snapshot.fxDate = historicalRates.date;

        // 4. Update the file on GitHub
        const content = JSON.stringify(snapshot, null, 2);
        await githubApi.updateFile(
          state.config,
          `snapshots/${entry.filename}`,
          content,
          meta.sha,
          `fix-fx: ${entry.date}`
        );

        updatedIndex.push({
          ...entry,
          totalInBase: snapshot.totalInBase,
        });
      } else {
        updatedIndex.push(entry);
      }
    }

    // 5. Update index.json
    progressEl.textContent = '更新 index.json...';
    const indexSha = await githubApi.getIndexSha(state.config);
    await githubApi.saveIndex(state.config, updatedIndex, indexSha);

    state.snapshotIndex = updatedIndex;
    saveLocalCache(state.currentItems, state.snapshotIndex, state.config.baseCurrency);

    progressEl.textContent = '全部完成 ✓';
    showToast('历史汇率矫正完成 ✓');
    renderSnapshotManageList();
    renderAll();
  } catch (err) {
    showToast(`矫正失败：${err.message}`, 4000);
    progressEl.textContent = `出错：${err.message}`;
    console.error(err);
  } finally {
    btn.disabled = false;
    textEl.textContent = '矫正历史汇率';
  }
}

// ─── HTML escaping ────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  bindEvents();
  const config = loadConfig();
  if (!config || !config.token || !config.owner || !config.repo) {
    showSetup();
    return;
  }
  state.config = config;
  showDashboard();

  // Pre-populate from cache so the UI isn't blank while GitHub loads
  const cache = loadLocalCache();
  if (cache) {
    state.currentItems = cache.items.map(i => ({ ...i }));
    state.savedItems = cache.items.map(i => ({ ...i }));
    state.snapshotIndex = cache.snapshotIndex || [];
    renderAll();
  }

  await loadData();
}

document.addEventListener('DOMContentLoaded', init);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then(reg => {
      // Check for updates on every page load
      reg.update();
      // When a new SW is waiting, activate it immediately
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage('skipWaiting');
          }
        });
      });
    })
    .catch(err => console.warn('SW registration failed:', err));
  // Reload when a new SW takes control
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}
