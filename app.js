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

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  config: null,           // { token, owner, repo, branch, baseCurrency }
  exchangeRates: null,    // { base, date, rates: {} }
  snapshotMeta: [],       // array of { name, sha, date, downloadUrl }
  snapshotData: [],       // array of loaded snapshot JSON objects (for chart)
  currentItems: [],       // current working items (editable)
  savedItems: [],         // items from the latest saved snapshot
  isDirty: false,
  trendChart: null,
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
  const fmt = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'JPY' || currency === 'KRW' || currency === 'IDR' ? 0 : 2,
    maximumFractionDigits: currency === 'JPY' || currency === 'KRW' || currency === 'IDR' ? 0 : 2,
  });
  try { return fmt.format(amount); } catch { return `${currency} ${amount.toFixed(2)}`; }
}

function formatAmountCompact(amount, currency) {
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
      .filter(f => f.name.endsWith('.json'))
      .map(f => ({
        name: f.name,
        sha: f.sha,
        downloadUrl: f.download_url,
        date: f.name.slice(0, 10),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async fetchSnapshot(downloadUrl) {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error('Failed to fetch snapshot');
    return res.json();
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

  async testConnection(cfg) {
    const url = `${this.baseUrl(cfg)}`;
    const res = await fetch(url, { headers: this.headers(cfg.token) });
    if (!res.ok) throw new Error(`无法连接仓库 (${res.status})`);
    return res.json();
  },
};

// ─── Exchange Rate API ────────────────────────────────────────────────────────

const fxApi = {
  async fetchRates(baseCurrency) {
    const url = `https://api.frankfurter.dev/v1/latest?base=${baseCurrency}`;
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
  const { currentItems, exchangeRates, config, snapshotData } = state;
  if (!config) return;

  const base = config.baseCurrency;
  let total = 0;

  if (exchangeRates) {
    total = currentItems.reduce((sum, item) => {
      const val = item.currency === base
        ? item.amount
        : item.amount / (exchangeRates.rates[item.currency] || 1);
      return sum + val;
    }, 0);
  }

  document.getElementById('total-amount').textContent = formatAmountCompact(total, base);
  document.getElementById('total-currency-badge').textContent = base;

  // Change vs previous snapshot
  const changeEl = document.getElementById('total-change');
  if (snapshotData.length >= 2) {
    const prev = snapshotData[snapshotData.length - 2];
    // Re-compute prev total in current base currency
    let prevTotal = 0;
    if (exchangeRates && prev.items) {
      prevTotal = prev.items.reduce((sum, item) => {
        const val = item.currency === base
          ? item.amount
          : item.amount / (exchangeRates.rates[item.currency] || 1);
        return sum + val;
      }, 0);
    } else {
      prevTotal = prev.totalInBase || 0;
    }
    const diff = total - prevTotal;
    const pct = prevTotal > 0 ? ((diff / prevTotal) * 100).toFixed(2) : 0;
    const sign = diff >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${formatAmountCompact(diff, base)} (${sign}${pct}%)`;
    changeEl.className = `total-change ${diff >= 0 ? 'positive' : 'negative'}`;
  } else {
    changeEl.textContent = '';
  }

  const dateEl = document.getElementById('total-date');
  dateEl.textContent = exchangeRates ? `汇率更新：${exchangeRates.date}` : '';
}

function renderAssetList() {
  const { currentItems, exchangeRates, config } = state;
  const listEl = document.getElementById('asset-list');
  const emptyEl = document.getElementById('asset-list-empty');

  if (currentItems.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  const base = config ? config.baseCurrency : 'CNY';

  listEl.innerHTML = currentItems.map(item => {
    const color = CATEGORY_COLORS[item.category] || CATEGORY_COLORS['其他'];
    const icon = CATEGORY_ICONS[item.category] || '💼';
    let valueInBase = item.amount;
    if (exchangeRates && item.currency !== base) {
      valueInBase = item.amount / (exchangeRates.rates[item.currency] || 1);
    }
    const showOrig = item.currency !== base;
    return `
      <div class="asset-item" data-id="${item.assetId}">
        <div class="asset-icon" style="background:${color}22;">
          <span>${icon}</span>
        </div>
        <div class="asset-info">
          <div class="asset-name">${escHtml(item.assetName)}</div>
          <div class="asset-meta">${escHtml(item.category)}${item.notes ? ' · ' + escHtml(item.notes) : ''}</div>
        </div>
        <div class="asset-amounts">
          <div class="asset-value-base">${formatAmount(valueInBase, base)}</div>
          ${showOrig ? `<div class="asset-value-orig">${formatAmount(item.amount, item.currency)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  listEl.querySelectorAll('.asset-item').forEach(el => {
    el.addEventListener('click', () => openEditModal(el.dataset.id));
  });
}

function renderCategoryBreakdown() {
  const { currentItems, exchangeRates, config } = state;
  const base = config ? config.baseCurrency : 'CNY';

  const totals = {};
  let grand = 0;
  for (const item of currentItems) {
    let val = item.amount;
    if (exchangeRates && item.currency !== base) {
      val = item.amount / (exchangeRates.rates[item.currency] || 1);
    }
    totals[item.category] = (totals[item.category] || 0) + val;
    grand += val;
  }

  const listEl = document.getElementById('category-list');
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  listEl.innerHTML = sorted.map(([cat, val]) => {
    const pct = grand > 0 ? (val / grand * 100) : 0;
    const color = CATEGORY_COLORS[cat] || CATEGORY_COLORS['其他'];
    return `
      <div class="category-row">
        <div class="category-dot" style="background:${color}"></div>
        <div class="category-name">${escHtml(cat)}</div>
        <div class="category-bar-wrap">
          <div class="category-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div>
        </div>
        <div class="category-pct">${pct.toFixed(0)}%</div>
      </div>`;
  }).join('');

  document.getElementById('category-card').classList.toggle('hidden', sorted.length === 0);
}

function renderTrendChart() {
  const { snapshotData, exchangeRates, config } = state;
  const base = config ? config.baseCurrency : 'CNY';

  const noDataEl = document.getElementById('chart-no-data');

  if (snapshotData.length < 1) {
    noDataEl.classList.remove('hidden');
    return;
  }
  noDataEl.classList.add('hidden');

  const labels = [];
  const values = [];

  for (const snap of snapshotData) {
    labels.push(snap.snapshotDate.slice(5)); // MM-DD
    // Recompute total in current base currency
    let total = 0;
    if (snap.baseCurrency === base) {
      total = snap.totalInBase;
    } else if (exchangeRates && snap.items) {
      total = snap.items.reduce((sum, item) => {
        const val = item.currency === base
          ? item.amount
          : item.amount / (exchangeRates.rates[item.currency] || 1);
        return sum + val;
      }, 0);
    } else {
      total = snap.totalInBase;
    }
    values.push(total);
  }

  const canvas = document.getElementById('trend-chart');
  const ctx = canvas.getContext('2d');

  if (state.trendChart) {
    state.trendChart.destroy();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, 'rgba(0,122,255,0.2)');
  gradient.addColorStop(1, 'rgba(0,122,255,0)');

  state.trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#007AFF',
        borderWidth: 2.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointRadius: values.length > 20 ? 0 : 4,
        pointHoverRadius: 6,
        pointBackgroundColor: '#007AFF',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatAmount(ctx.raw, base),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#8E8E93', font: { size: 11 }, maxTicksLimit: 6 },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            color: '#8E8E93',
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
  renderCategoryBreakdown();
  renderTrendChart();
  renderSaveButton();
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  setLoading(true);
  try {
    const [snapshotMeta, rates] = await Promise.all([
      githubApi.listSnapshots(state.config),
      fxApi.fetchRates(state.config.baseCurrency),
    ]);

    state.snapshotMeta = snapshotMeta;
    state.exchangeRates = rates;

    // Update FX date in settings
    const fxDateEl = document.getElementById('fx-rate-date');
    if (fxDateEl) fxDateEl.textContent = `汇率日期：${rates.date}`;

    // Load snapshot data for chart (load all, but limit to last 100)
    const toLoad = snapshotMeta.slice(-100);
    const snapshots = await Promise.all(
      toLoad.map(m => githubApi.fetchSnapshot(m.downloadUrl).catch(() => null))
    );
    state.snapshotData = snapshots.filter(Boolean);

    // Set current items from latest snapshot
    if (state.snapshotData.length > 0) {
      const latest = state.snapshotData[state.snapshotData.length - 1];
      state.currentItems = latest.items.map(i => ({ ...i }));
      state.savedItems = latest.items.map(i => ({ ...i }));
    } else {
      state.currentItems = [];
      state.savedItems = [];
    }
    state.isDirty = false;

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
  renderCategoryBreakdown();
  renderTotalCard();
}

function updateItem(assetId, data) {
  const idx = state.currentItems.findIndex(i => i.assetId === assetId);
  if (idx !== -1) {
    state.currentItems[idx] = { ...state.currentItems[idx], ...data };
    markDirty();
    renderAssetList();
    renderCategoryBreakdown();
    renderTotalCard();
  }
}

function deleteItem(assetId) {
  state.currentItems = state.currentItems.filter(i => i.assetId !== assetId);
  markDirty();
  renderAssetList();
  renderCategoryBreakdown();
  renderTotalCard();
}

async function saveSnapshot() {
  const btn = document.getElementById('btn-save-snapshot');
  const textEl = document.getElementById('btn-save-text');
  btn.disabled = true;
  textEl.textContent = '保存中...';

  try {
    const snapshot = buildSnapshot(state.currentItems, state.config.baseCurrency, state.exchangeRates);
    await githubApi.saveSnapshot(state.config, snapshot);

    state.savedItems = state.currentItems.map(i => ({ ...i }));
    state.snapshotData.push(snapshot);
    state.isDirty = false;

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

function bindEvents() {
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

  // Setup autocomplete
  setupAutocomplete();
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
  await loadData();
}

document.addEventListener('DOMContentLoaded', init);
