/* ═══════════════════════════════════════════════════════════════════
   e³ argos V5 — Dashboard application logic
   ═══════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────
// CONFIG & STATE
// ─────────────────────────────────────────
const CFG_KEY = 'e3argos_v5_cfg';

let cfg = {
  cloudUrl:    'https://argos-optimizer-253723725213.europe-west1.run.app',
  capitalUsd:  10000,
  sheetId:     '1xIYKJVd-P2uZ7c7GLu1oY0tO9IaGQZOcgTqikPU_HGo',
};
try {
  const saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
  if (saved.cloudUrl)   cfg.cloudUrl   = saved.cloudUrl;
  if (saved.capitalUsd) cfg.capitalUsd = parseFloat(saved.capitalUsd) || 10000;
} catch(e) {}

let state = {
  currency:            'USD',
  fxRates:             { USD: 1, EUR: 0.92 },
  chartPeriod:         'all',
  equityChart:         null,
  sparkChart:          null,
  donutChart:          null,
  pieSlide:            0,  // 0=total, 1=trend, 2=grid
  allRows:             [],
  cycleRows:           [],
  estadoMotores:       [],
  motorStateArr:       [],
  btcT0Price:          null,
  btcT0IsLive:         false,   // true = t0 viene de live price (sin datos históricos)
  btcKlines:           {},      // { openTimeMs: closePrice } — klines Binance 1h
  clientUnrealizedPnl: 0,
  benchmarkRows:       [],   // filas de tab BENCHMARK (timestamp, argos_return_pct, btc_return_pct, alpha_pp, …)
  benchmarkConfig:     {},   // dict de tab CONFIG (t_0, capital_0, btc_0, …)
};

const MOTORS_DEF = [
  { id: 'trend',       label: 'Motor 1 — Trend',        desc: 'Dual Momentum ETF-like' },
  { id: 'spot_grid',   label: 'Motor 2 — Spot Grid',    desc: 'Grid ±10% (Sprint D, cap ≥5k)' },
  { id: 'perp_grid',   label: 'Motor 3 — Perp Grid',    desc: 'Grid futuros perpetuos (Sprint D)' },
  { id: 'funding_arb', label: 'Motor 4 — Funding Arb',  desc: 'Arbitraje funding rate (Sprint E)' },
];

const PIE_COLORS = [
  '#C9A96E', '#DFC08A', '#0DB375', '#60A5FA', '#A78BFA',
  '#F59E0B', '#22C98C', '#818CF8', '#F472B6', '#FB923C',
  '#38BDF8', '#FCD34D', '#E879F9', '#4ADE80', '#C084FC',
];
const USDT_COLOR = '#3A5A7A';

let livePrices = {};

// ─────────────────────────────────────────
// CONFIG OVERLAY
// ─────────────────────────────────────────
function loadConfigForm() {
  document.getElementById('inp-cloud-url').value = cfg.cloudUrl || '';
  document.getElementById('inp-capital').value   = cfg.capitalUsd || 10000;
}
function saveConfig() {
  const u = document.getElementById('inp-cloud-url').value.trim().replace(/\/$/, '');
  const c = parseFloat(document.getElementById('inp-capital').value) || 10000;
  if (u) cfg.cloudUrl = u;
  cfg.capitalUsd = c;
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  closeConfig();
  refreshAll();
}
function openConfig()  { loadConfigForm(); document.getElementById('cfg-overlay').style.display = 'flex'; }
function closeConfig() { document.getElementById('cfg-overlay').style.display = 'none'; }

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initEquityChart();
  initDonut();
  renderMotors([], []);
  if (!cfg.cloudUrl) openConfig();
  else               refreshAll();
  setInterval(refreshAll, 5 * 60 * 1000);
});

// ─────────────────────────────────────────
// CURRENCY & FORMATTING
// ─────────────────────────────────────────
function setCurrency(cur) {
  state.currency = cur;
  document.querySelectorAll('.cur-btn').forEach(b => b.classList.toggle('active', b.textContent === cur));
  renderKPIs(state.clientUnrealizedPnl);
  renderPerformance();
  renderMotors(state.estadoMotores, state.motorStateArr);
  renderCycleHistory(state.cycleRows);
  renderEquityChart();
  renderDonut();
  const btcLive = livePrices['BTCUSDT'];
  if (btcLive?.price) {
    setLabel('btc-label', 'BTC ' + fmtMoneyCompact(btcLive.price));
  }
}

async function fetchFxRates() {
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    const d = await r.json();
    state.fxRates = { USD: 1, EUR: d.usd?.eur || 0.92 };
  } catch(e) {}
}

function curSym() { return { EUR: '€', USD: '$' }[state.currency] || '$'; }
function toDisplay(usd) { return (parseFloat(usd) || 0) * (state.fxRates[state.currency] || 1); }
function fmtMoney(usd, forceSign) {
  const v = toDisplay(usd);
  const abs = Math.abs(v);
  const sign = (forceSign && v >= 0) ? '+' : (v < 0 ? '-' : '');
  return sign + abs.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + curSym();
}
function fmtMoneyCompact(usd) {
  const v = toDisplay(usd);
  if (Math.abs(v) >= 1000) return curSym() + v.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  return curSym() + v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
function fmtPct(v, forceSign) {
  const n = parseFloat(v) || 0;
  return (forceSign && n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtTime(d) {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDatetime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return isoStr.slice(0, 16).replace('T', ' '); }
}
function fmtPrice(p) {
  if (!p || p === 0) return '—';
  const v = toDisplay(p);
  if (v >= 1000) return curSym() + v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  if (v >= 1)    return curSym() + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return curSym() + v.toLocaleString('de-DE', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
function setDot(id, s) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'dot ' + (s === 'live' ? 'dot-live' : s === 'dead' ? 'dot-dead' : 'dot-idle');
}
function setPillClass(id, cls) {
  const el = document.getElementById(id);
  if (el) el.className = 'status-pill ' + cls + (el.classList.contains('hide-md') ? ' hide-md' : '');
}
function setLabel(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}
function clsFor(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'neu'; }

// ─────────────────────────────────────────
// FETCH — Cloud Run /data
// ─────────────────────────────────────────
async function fetchData() {
  if (!cfg.cloudUrl) return null;
  const r = await fetch(cfg.cloudUrl + '/data', { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchLivePrices(symbols) {
  const uniqueSyms = [...new Set(['BTCUSDT', ...symbols])];
  await Promise.allSettled(uniqueSyms.map(async sym => {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
      if (!r.ok) return;
      const t = await r.json();
      livePrices[sym] = {
        price:  parseFloat(t.lastPrice          || 0),
        chg24h: parseFloat(t.priceChangePercent || 0),
      };
    } catch(e) {}
  }));
}

// ─────────────────────────────────────────
// BTC KLINES — historial horario Binance
// ─────────────────────────────────────────
async function fetchBtcKlines(startMs, endMs) {
  try {
    const start = Math.floor(startMs / 3600000) * 3600000 - 3600000; // 1h antes
    const end   = Math.ceil(endMs   / 3600000) * 3600000 + 3600000;  // 1h después
    const url   = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${start}&endTime=${end}&limit=500`;
    const r     = await fetch(url);
    if (!r.ok) return {};
    const data  = await r.json();
    const map   = {};
    data.forEach(k => { map[parseInt(k[0])] = parseFloat(k[4]); }); // openTime → close
    return map;
  } catch(e) { return {}; }
}

function lookupBtcKline(klines, tsMs) {
  if (!klines || !Object.keys(klines).length) return 0;
  const h = 3600000;
  const slot = Math.floor(tsMs / h) * h;
  return klines[slot] || klines[slot - h] || klines[slot + h] || 0;
}

// ─────────────────────────────────────────
// MAIN REFRESH
// ─────────────────────────────────────────
async function refreshAll() {
  fetchFxRates();

  let payload = null;
  try {
    payload = await fetchData();
    setDot('data-dot', 'live');
    setPillClass('pill-data', 'live');
    setLabel('data-label', 'Cloud Run ' + fmtTime(new Date()));
    setLabel('ts-update', fmtTime(new Date()));
  } catch(e) {
    setDot('data-dot', 'dead');
    setPillClass('pill-data', 'error');
    setLabel('data-label', 'Error conexión');
    console.error('fetchData:', e);
    return;
  }

  // Agregar por cycle_id (multi-motor)
  const allEstado = payload?.estado_motores || [];
  const cycleMap = {};
  allEstado.forEach(r => {
    const cid = r.cycle_id || r.last_updated;
    if (!cycleMap[cid]) {
      cycleMap[cid] = { ...r, realized_pnl_usd: 0, unrealized_pnl_usd: 0, capital_deployed_usd: 0 };
    }
    cycleMap[cid].realized_pnl_usd     += parseFloat(r.realized_pnl_usd     || 0);
    cycleMap[cid].unrealized_pnl_usd   += parseFloat(r.unrealized_pnl_usd   || 0);
    cycleMap[cid].capital_deployed_usd += parseFloat(r.capital_deployed_usd || 0);
    if ((r.last_updated || '') > (cycleMap[cid].last_updated || '')) {
      cycleMap[cid].last_updated = r.last_updated;
    }
    // Preservar btc_price del primer motor que lo tenga (evita perderlo si Motor 1 no lo escribe)
    if (parseFloat(r.btc_price || 0) > 0 && !(parseFloat(cycleMap[cid].btc_price || 0) > 0)) {
      cycleMap[cid].btc_price = r.btc_price;
    }
  });
  const rows = Object.values(cycleMap).sort((a, b) => (a.last_updated || '').localeCompare(b.last_updated || ''));
  state.allRows = rows;

  const motorStateArr = payload?.motor_state || [];
  const basketSyms = [];
  motorStateArr.forEach(ms => {
    const basket = (ms.basket || {}).basket || {};
    Object.keys(basket).forEach(sym => basketSyms.push(sym.replace('/', '')));
  });

  await fetchLivePrices(basketSyms);

  const btcLive = livePrices['BTCUSDT'];
  if (btcLive?.price) {
    setDot('btc-dot', 'live');
    setPillClass('pill-btc', 'live');
    setLabel('btc-label', 'BTC ' + fmtMoneyCompact(btcLive.price));
  } else {
    setDot('btc-dot', 'dead');
    setPillClass('pill-btc', 'error');
    setLabel('btc-label', 'BTC —');
  }

  state.estadoMotores  = payload?.estado_motores  || [];
  state.motorStateArr  = motorStateArr;
  state.cycleRows      = rows;
  state.benchmarkRows  = payload?.benchmark        || [];
  state.benchmarkConfig= payload?.benchmark_config || {};

  if (!rows.length) {
    renderKPIs();
    renderPerformance();
    renderBenchmarkKPIs();
    renderAlphaCard();
    renderMotors(state.estadoMotores, state.motorStateArr);
    return;
  }

  const latest = rows[rows.length - 1];
  setLabel('cycle-badge', (latest.cycle_id || '—').slice(-8));

  // Comprobar si los datos del sheet incluyen btc_price
  // Fetch klines si rows[0] no tiene btc_price — necesitamos referencia exacta para t0
  const r0HasBtc = parseFloat(rows[0]?.btc_price || 0) > 0;

  if (!r0HasBtc && rows.length >= 1 && !Object.keys(state.btcKlines).length) {
    const startMs = new Date(rows[0].last_updated).getTime();
    const endMs   = new Date(rows[rows.length - 1].last_updated).getTime();
    state.btcKlines = await fetchBtcKlines(startMs, endMs);
  }

  // Fijar btcT0Price si aún no está
  if (!state.btcT0Price) {
    const t0Sheet  = parseFloat(rows[0]?.btc_price || 0);
    const t0Kline  = lookupBtcKline(state.btcKlines, new Date(rows[0]?.last_updated).getTime());
    const t0Live   = livePrices['BTCUSDT']?.price || 0;
    if (t0Sheet > 0) {
      state.btcT0Price  = t0Sheet;
      state.btcT0IsLive = false;
    } else if (t0Kline > 0) {
      state.btcT0Price  = t0Kline;
      state.btcT0IsLive = false;
    } else if (t0Live > 0) {
      state.btcT0Price  = t0Live;
      state.btcT0IsLive = true;
    }
  }

  let clientUnrealizedPnl = 0;
  motorStateArr.forEach(ms => {
    const basket = (ms.basket || {}).basket || {};
    Object.entries(basket).forEach(([sym, pos]) => {
      const bybitSym  = sym.replace('/', '');
      const lp        = livePrices[bybitSym] || livePrices[sym];
      const livePrice = lp?.price || 0;
      const avgPrice  = parseFloat(pos.avg_price || 0);
      const qty       = parseFloat(pos.qty || 0);
      if (livePrice > 0 && avgPrice > 0) {
        clientUnrealizedPnl += (livePrice - avgPrice) * qty;
      }
    });
  });
  state.clientUnrealizedPnl = clientUnrealizedPnl;

  renderKPIs(clientUnrealizedPnl);
  renderPerformance();
  renderBenchmarkKPIs();
  renderAlphaCard();
  renderMotors(state.estadoMotores, motorStateArr);
  renderCycleHistory(rows);
  renderEquityChart();
  renderDonut();
}

// ─────────────────────────────────────────
// RENDER — KPIs (hero + regime + pnl)
// ─────────────────────────────────────────
function renderKPIs(clientUnrealizedPnl) {
  const rows   = state.allRows;
  const latest = rows.length ? rows[rows.length - 1] : null;
  const cap    = cfg.capitalUsd || 10000;

  const realPnlRaw   = parseFloat(latest?.realized_pnl_usd || 0);
  const realPnlAtT0  = parseFloat(state.benchmarkConfig?.realized_pnl_at_t0 || 0);
  const realPnl      = realPnlRaw - realPnlAtT0;

  // Capital Total: BENCHMARK es la fuente canónica (el cálculo con cfg.capitalUsd produce valores heredados incorrectos)
  const bmLastKpi   = state.benchmarkRows?.length ? state.benchmarkRows[state.benchmarkRows.length - 1] : null;
  const capital0Kpi = parseFloat(state.benchmarkConfig?.capital_0 || 0);
  const bm_equity   = bmLastKpi ? parseFloat(bmLastKpi.argos_equity || 0) : 0;
  // Fix 2026-04-23: sumar clientUnrealizedPnl al bm_equity para actualizar portfolio
  // con precios live entre ciclos (bm_equity = cost_basis; unr = mark-to-market delta)
  const portfolio   = (bm_equity > 0 && capital0Kpi > 0) ? bm_equity + (clientUnrealizedPnl ?? 0) : cap + (realPnl + (clientUnrealizedPnl ?? 0));
  const portDelta   = capital0Kpi > 0 ? portfolio - capital0Kpi : realPnl + (clientUnrealizedPnl ?? 0);

  // Almacenar para donut y stubs M3/M4 (trend 55% + spot_grid 10% = 65% en RISK_ON 10k)
  state.portfolioTotal = portfolio;
  state.totalCapital   = portfolio > 0 ? portfolio / 0.65 : (cfg.capitalUsd || 10000);

  // P&L total: BENCHMARK + unrealized live
  const clientUnr = clientUnrealizedPnl !== undefined
    ? clientUnrealizedPnl
    : parseFloat(latest?.unrealized_pnl_usd || 0);
  const totalPnl = capital0Kpi > 0 ? portDelta : realPnl + clientUnr;
  const unrPnl = totalPnl - realPnl;

  // Hero portfolio
  document.getElementById('kpi-portfolio').textContent = fmtMoney(portfolio);

  const portPct = capital0Kpi > 0 ? (portDelta / capital0Kpi) * 100
                : cap > 0 ? (totalPnl / cap) * 100 : 0;
  const portChip = document.getElementById('kpi-portfolio-pct');
  portChip.textContent = latest ? fmtPct(portPct, true) : '—';
  portChip.className = 'delta-chip ' + clsFor(portPct);

  const portAbs = document.getElementById('kpi-portfolio-abs');
  portAbs.textContent = latest ? (portDelta >= 0 ? '+' : '') + fmtMoney(portDelta) + ' total' : '—';

  // Deployed bar
  const allocated = parseFloat(latest?.capital_allocated_usd || 0);
  const pct = cap > 0 ? Math.min(100, (allocated / cap) * 100) : 0;
  document.getElementById('kpi-deployed-bar').style.width = pct.toFixed(1) + '%';
  document.getElementById('kpi-deployed-pct').textContent = pct.toFixed(0) + '%';
  document.getElementById('kpi-allocated').textContent = fmtMoneyCompact(allocated);
  document.getElementById('kpi-free').textContent = fmtMoneyCompact(Math.max(0, cap - allocated));

  // Regime
  const regime = (latest?.regime || '').toLowerCase();
  const regimeMap = {
    risk_on:    { label: 'RISK ON',    cls: 'risk_on',    icon: 'up' },
    risk_off:   { label: 'RISK OFF',   cls: 'risk_off',   icon: 'neutral' },
    stand_down: { label: 'STAND DOWN', cls: 'stand_down', icon: 'down' },
  };
  const rm = regimeMap[regime] || { label: regime || '—', cls: 'unknown', icon: 'neutral' };

  const pill = document.getElementById('regime-pill');
  pill.className = 'regime-badge regime-' + rm.cls;
  document.getElementById('regime-label').textContent = rm.label;

  document.getElementById('kpi-regime-val').textContent = rm.label;
  // Color the regime icon based on regime
  const regIcon = document.getElementById('regime-icon');
  if (regIcon) {
    const col = rm.cls === 'risk_on' ? 'var(--e-green)' :
                rm.cls === 'risk_off' ? 'var(--e-amber)' :
                rm.cls === 'stand_down' ? 'var(--e-red)' :
                'var(--e-gold)';
    const bg = rm.cls === 'risk_on' ? 'rgba(13,179,117,0.1)' :
               rm.cls === 'risk_off' ? 'rgba(245,158,11,0.1)' :
               rm.cls === 'stand_down' ? 'rgba(232,64,64,0.1)' :
               'var(--e-gold-08)';
    const bd = rm.cls === 'risk_on' ? 'rgba(13,179,117,0.3)' :
               rm.cls === 'risk_off' ? 'rgba(245,158,11,0.3)' :
               rm.cls === 'stand_down' ? 'rgba(232,64,64,0.3)' :
               'rgba(201,169,110,0.25)';
    regIcon.style.color = col;
    regIcon.style.background = bg;
    regIcon.style.borderColor = bd;
  }

  document.getElementById('kpi-tier-label').textContent = latest?.tier || '—';
  document.getElementById('kpi-positions').textContent = latest?.open_positions ?? '—';

  // PnL split — % calculados consistentemente para que Realiz. + No Realiz. = Total
  // portPct ya es el total canónico; realPct se calcula igual; unrPct = portPct - realPct
  const pnlBase  = capital0Kpi > 0 ? capital0Kpi : cap;
  const realPct  = pnlBase > 0 ? (realPnl / pnlBase) * 100 : 0;
  const unrPct   = portPct - realPct;   // garantiza suma exacta siempre

  const pnlUnrPct = document.getElementById('kpi-pnl-unr-pct');
  pnlUnrPct.textContent = latest ? fmtPct(unrPct, true) : '—';
  pnlUnrPct.className = 'pnl-big ' + clsFor(unrPnl);
  const pnlUnr = document.getElementById('kpi-pnl-unr');
  pnlUnr.textContent = latest ? fmtMoney(unrPnl, true) : '—';
  pnlUnr.className = 'pnl-small ' + clsFor(unrPnl);

  const pnlRealPct = document.getElementById('kpi-pnl-real-pct');
  pnlRealPct.textContent = latest ? fmtPct(realPct, true) : '—';
  pnlRealPct.className = 'pnl-big ' + clsFor(realPnl);
  const pnlReal = document.getElementById('kpi-pnl-real');
  pnlReal.textContent = latest ? fmtMoney(realPnl, true) : '—';
  pnlReal.className = 'pnl-small ' + clsFor(realPnl);

  const pnlNet = document.getElementById('kpi-pnl-net');
  pnlNet.textContent = latest ? fmtMoney(totalPnl, true) : '—';
  pnlNet.className = 'mono ' + clsFor(totalPnl);

  // Error
  const errEl = document.getElementById('kpi-error-label');
  if (latest?.last_error) {
    errEl.innerHTML = `<span style="color:var(--e-red)">⚠ ${latest.last_error}</span>`;
  } else if (latest) {
    errEl.innerHTML = `<span style="color:var(--e-green)">✓ Sin errores</span>`;
  } else {
    errEl.innerHTML = '';
  }
}

// ─────────────────────────────────────────
// PERFORMANCE BLOCK (hero right) — % total + alfa BTC + 24h triangles
// ─────────────────────────────────────────
function renderPerformance() {
  const totalEl = document.getElementById('perf-total-pct');
  const totalTrendEl = document.getElementById('perf-total-trend');
  const alphaEl = document.getElementById('perf-alpha-pct');
  const alphaTrendEl = document.getElementById('perf-alpha-trend');
  const alphaSubEl = document.getElementById('perf-alpha-sub');
  if (!totalEl || !alphaEl) return;

  const rows   = state.allRows || [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const cap    = cfg.capitalUsd || 10000;

  const setTri = (el, v, label) => {
    if (!el) return;
    const c = v === null ? 'neu' : (v > 0.01 ? 'up' : v < -0.01 ? 'down' : 'neu');
    const glyph = c === 'up' ? '▲' : c === 'down' ? '▼' : '◆';
    el.className = 'perf-trend ' + c;
    el.innerHTML = `<span class="tri">${glyph}</span><span class="v">${v === null ? '—' : fmtPct(v, true)}</span>`;
  };

  if (!latest) {
    totalEl.textContent = '—'; totalEl.className = 'perf-big neu';
    alphaEl.textContent = '—'; alphaEl.className = 'perf-big neu';
    setTri(totalTrendEl, null);
    setTri(alphaTrendEl, null);
    if (alphaSubEl) alphaSubEl.textContent = 'Argos · BTC hold desde t₀';
    return;
  }

  // ── Si hay datos BENCHMARK, calcular returns live desde capital_0/btc_0 ──
  // (no usar argos_return_pct del tab — solo es preciso en el instante del ciclo horario)
  const bmRows = state.benchmarkRows || [];
  if (bmRows.length > 0) {
    const bmLast = bmRows[bmRows.length - 1];

    // Return Argos: usar portfolio LIVE (state.portfolioTotal incluye clientUnrealizedPnl)
    // Fix 2026-04-23: argos_return_pct del tab solo se actualiza en ciclos horarios —
    // usar portfolio live para que el % se mueva con precios en tiempo real.
    const capital0 = parseFloat(state.benchmarkConfig?.capital_0 || 0);
    const btc0     = parseFloat(state.benchmarkConfig?.btc_0 || 0);
    const argosRet = (capital0 > 0 && state.portfolioTotal > 0)
      ? ((state.portfolioTotal / capital0) - 1) * 100
      : parseFloat(bmLast.argos_return_pct || 0);

    // Return live BTC hold: precio actual vs btc_0
    const btcNow = livePrices['BTCUSDT']?.price || parseFloat(latest.btc_price || 0);
    const btcRet = btc0 > 0 && btcNow > 0 ? (btcNow / btc0 - 1) * 100 : parseFloat(bmLast.btc_return_pct || 0);
    const alphaVal = argosRet - btcRet;

    totalEl.textContent = fmtPct(argosRet, true);
    totalEl.className   = 'perf-big ' + clsFor(argosRet);
    alphaEl.textContent = fmtPct(alphaVal, true);
    alphaEl.className   = 'perf-big ' + clsFor(alphaVal);

    // kpi-pnl-total-pct (panel P&L del regime card)
    const pnlTotalPctEl = document.getElementById('kpi-pnl-total-pct');
    if (pnlTotalPctEl) {
      pnlTotalPctEl.textContent = fmtPct(argosRet, true);
      pnlTotalPctEl.className   = 'pnl-total-pct ' + clsFor(argosRet);
    }

    // Trend chips: 24h deltas desde benchmark
    const cutoff24 = Date.now() - 24 * 3600 * 1000;
    const bm24 = bmRows.filter(r => new Date(r.timestamp).getTime() >= cutoff24);
    let argos24 = null; let btcBm24 = null;
    if (bm24.length >= 2) {
      const r0l = bm24[0]; const rnl = bm24[bm24.length - 1];
      const a0 = parseFloat(r0l.argos_return_pct || 0);
      const an = parseFloat(rnl.argos_return_pct  || 0);
      argos24 = an - a0;
      const b0 = parseFloat(r0l.btc_return_pct || 0);
      const bn = parseFloat(rnl.btc_return_pct  || 0);
      btcBm24 = bn - b0;
    }
    setTri(totalTrendEl, argos24);
    setTri(alphaTrendEl, btcBm24);
    if (alphaSubEl) {
      const a24s = argos24 === null ? '—' : fmtPct(argos24, true);
      const b24s = btcBm24 === null ? '—' : fmtPct(btcBm24, true);
      const cfg2 = state.benchmarkConfig || {};
      const t0label = cfg2.t_0 ? cfg2.t_0.slice(0, 10) : 't₀';
      alphaSubEl.innerHTML = `Argos <span class="${clsFor(argos24 || 0)}">${a24s}</span> · BTC <span class="${clsFor(btcBm24 || 0)}">${b24s}</span> <span style="color:var(--e-muted);font-size:0.58rem">desde ${t0label}</span>`;
    }
    return;
  }

  // Total rentabilidad % (vs capital inicial) — realPnl ajustado desde t_0
  const realPnlRaw2  = parseFloat(latest.realized_pnl_usd || 0);
  const realPnlAtT02 = parseFloat(state.benchmarkConfig?.realized_pnl_at_t0 || 0);
  const realPnl      = realPnlRaw2 - realPnlAtT02;
  const unrPnl   = (state.clientUnrealizedPnl !== undefined) ? state.clientUnrealizedPnl : parseFloat(latest.unrealized_pnl_usd || 0);
  const totalPnl = realPnl + unrPnl;
  const totalPct = cap > 0 ? (totalPnl / cap) * 100 : 0;
  const totalCls = clsFor(totalPct);

  // Alfa vs BTC (Argos return − BTC return desde t0)
  const cycleRet = totalPct;
  let btcRet = null;
  if (state.btcT0Price && !state.btcT0IsLive) {
    // Caso nominal: t0 desde sheet o klines — cálculo real
    const btcNow = livePrices['BTCUSDT']?.price || parseFloat(latest.btc_price || 0);
    if (btcNow > 0) btcRet = ((btcNow / state.btcT0Price) - 1) * 100;
  } else {
    // Fallback: usar cambio 24h de BTC como proxy del retorno desde primera referencia
    const chg = livePrices['BTCUSDT']?.chg24h;
    if (chg != null) btcRet = chg;
  }
  const alfa = btcRet !== null ? (cycleRet - btcRet) : null;

  // 24h deltas (Argos portfolio equity rolling 24h)
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const rows24 = rows.filter(r => new Date(r.last_updated).getTime() >= cutoff);
  let argos24 = null;
  if (rows24.length >= 2) {
    const r0 = rows24[0];
    const lastIdx = rows24.length - 1;
    const firstEq = cap + parseFloat(r0.realized_pnl_usd || 0) + parseFloat(r0.unrealized_pnl_usd || 0);
    const lastEq  = cap + parseFloat(rows24[lastIdx].realized_pnl_usd || 0) + state.clientUnrealizedPnl;
    if (firstEq > 0) argos24 = ((lastEq / firstEq) - 1) * 100;
  }
  const btc24 = livePrices['BTCUSDT']?.chg24h ?? null;

  // PRIMARY — rentabilidad total %
  totalEl.textContent = fmtPct(totalPct, true);
  totalEl.className = 'perf-big ' + totalCls;
  setTri(totalTrendEl, argos24);  // trend chip = 24h Argos

  // kpi-pnl-total-pct: mismo % total en el panel P&L del regime card
  const pnlTotalPctEl = document.getElementById('kpi-pnl-total-pct');
  if (pnlTotalPctEl) { pnlTotalPctEl.textContent = fmtPct(totalPct, true); pnlTotalPctEl.className = 'pnl-total-pct ' + totalCls; }

  // SECONDARY — alfa vs BTC
  alphaEl.textContent = alfa === null ? '—' : fmtPct(alfa, true);
  alphaEl.className = 'perf-big ' + (alfa === null ? 'neu' : clsFor(alfa));
  setTri(alphaTrendEl, btc24);  // trend chip = BTC 24h
  if (alphaSubEl) {
    const argosStr = argos24 === null ? '—' : fmtPct(argos24, true);
    const btcStr   = btc24   === null ? '—' : fmtPct(btc24, true);
    const liveTag  = state.btcT0IsLive ? ' <span style="color:var(--e-amber);font-size:0.58rem">~sesión</span>' : '';
    alphaSubEl.innerHTML = `Argos <span class="${argos24 === null ? '' : clsFor(argos24)}">${argosStr}</span> · BTC <span class="${btc24 === null ? '' : clsFor(btc24)}">${btcStr}</span>${liveTag}`;
  }
}

// ─────────────────────────────────────────
// EQUITY CHART (main)
// ─────────────────────────────────────────
function initEquityChart() {
  const ctx = document.getElementById('equity-chart').getContext('2d');
  state.equityChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Argos V5',
          data: [], fill: true,
          borderColor: '#C9A96E', borderWidth: 2,
          pointRadius: 0, pointHoverRadius: 4, pointBackgroundColor: '#DFC08A',
          pointBorderColor: '#C9A96E', pointBorderWidth: 2,
          tension: 0.35,
        },
        {
          label: 'BTC Hold',
          data: [], fill: false,
          borderColor: 'rgba(122,143,168,0.65)',
          borderWidth: 1.25, borderDash: [4, 4],
          pointRadius: 0, pointHoverRadius: 3, tension: 0.35,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(6,19,36,0.96)',
          titleColor: '#7A8FA8', bodyColor: '#F2EDE3',
          borderColor: '#17314C', borderWidth: 1,
          padding: 12, titleFont: { size: 10, weight: 500, family: 'Inter' },
          bodyFont: { size: 12, family: 'JetBrains Mono', weight: 600 },
          displayColors: true, usePointStyle: true,
          callbacks: {
            label: c => {
              const v = c.parsed.y;
              const sign = v >= 0 ? '+' : '';
              return `  ${c.dataset.label}: ${sign}${v.toFixed(2)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#3A4D5E', font: { size: 10, family: 'JetBrains Mono' }, maxTicksLimit: 6 },
          grid:  { color: 'rgba(17,38,61,0.5)', drawTicks: false },
          border: { display: false },
        },
        y: {
          ticks: {
            color: '#3A4D5E',
            font: { size: 10, family: 'JetBrains Mono' },
            callback: v => {
              const abs = Math.abs(v);
              const dec = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
              return (v >= 0 ? '+' : '') + v.toFixed(dec) + '%';
            }
          },
          grid: {
            color: c => c.tick.value === 0 ? 'rgba(201,169,110,0.35)' : 'rgba(17,38,61,0.5)',
            lineWidth: c => c.tick.value === 0 ? 1.25 : 1,
            drawTicks: false,
          },
          border: { display: false },
        }
      }
    }
  });
}

function setChartPeriod(btn, period) {
  btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.chartPeriod = period;
  renderEquityChart();
}

function renderEquityChart() {
  const chart = state.equityChart;
  if (!chart) return;
  const emptyEl = document.getElementById('chart-empty');

  // ── CAMINO BENCHMARK: usa columnas pre-calculadas del GSheet ──────────────
  // Disponible después del primer ciclo post-deploy rev 00053.
  // Resuelve el bug de la línea BTC (btcT0Price inconsistente).
  const bmAllRows = state.benchmarkRows || [];
  if (bmAllRows.length >= 2) {
    let bmRows = [...bmAllRows];
    if (state.chartPeriod !== 'all') {
      const hours  = state.chartPeriod === '30d' ? 720 : state.chartPeriod === '7d' ? 168 : 24;
      const cutoff = Date.now() - hours * 3600 * 1000;
      bmRows = bmRows.filter(r => new Date(r.timestamp).getTime() >= cutoff);
    }
    if (!bmRows.length) { emptyEl.style.display = 'flex'; return; }
    emptyEl.style.display = 'none';

    const argosData = bmRows.map(r => parseFloat(r.argos_return_pct || 0));
    const btcData   = bmRows.map(r => parseFloat(r.btc_return_pct   || 0));
    const labels    = bmRows.map(r => fmtDatetime(r.timestamp));

    // Área sombreada entre líneas: verde si Argos > BTC, rojo si BTC > Argos
    chart.data.datasets[1].fill = {
      target: 0,
      above: 'rgba(232,64,64,0.07)',      // BTC encima de Argos → mal
      below: 'rgba(201,169,110,0.13)',    // BTC debajo de Argos → Argos gana
    };

    const ctx  = chart.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    grad.addColorStop(0,   'rgba(201,169,110,0.22)');
    grad.addColorStop(0.5, 'rgba(201,169,110,0.06)');
    grad.addColorStop(1,   'rgba(201,169,110,0.00)');
    chart.data.datasets[0].backgroundColor = grad;

    chart.data.labels           = labels;
    chart.data.datasets[0].data = argosData;
    chart.data.datasets[1].data = btcData;

    const lastArgos = argosData[argosData.length - 1];
    const lastBtc   = btcData[btcData.length - 1];
    const la = document.getElementById('legend-argos-val');
    const lb = document.getElementById('legend-btc-val');
    if (la) { la.textContent = fmtPct(lastArgos, true); la.style.color = lastArgos >= 0 ? 'var(--e-green)' : 'var(--e-red)'; }
    if (lb) { lb.textContent = fmtPct(lastBtc,   true); lb.style.color = lastBtc   >= 0 ? 'var(--e-green)' : 'var(--e-red)'; }

    const allVals = [...argosData, ...btcData].filter(v => !isNaN(v));
    if (allVals.length) {
      const dataMin = Math.min(...allVals); const dataMax = Math.max(...allVals);
      const range = dataMax - dataMin;
      const pad   = Math.max(range * 0.15, 0.5);
      let yMin = dataMin - pad; let yMax = dataMax + pad;
      if (dataMin >= 0) yMin = Math.min(0, yMin);
      if (dataMax <= 0) yMax = Math.max(0, yMax);
      chart.options.scales.y.min = yMin;
      chart.options.scales.y.max = yMax;
    } else {
      chart.options.scales.y.min = -1;
      chart.options.scales.y.max =  1;
    }
    chart.update();
    return;
  }

  // ── FALLBACK: ESTADO_MOTORES (pre-benchmark, <rev 00053) ─────────────────
  let rows = [...state.allRows];
  if (!rows.length) { emptyEl.style.display = 'flex'; return; }

  if (state.chartPeriod !== 'all') {
    const hours = state.chartPeriod === '30d' ? 720 : state.chartPeriod === '7d' ? 168 : 24;
    const cutoff = Date.now() - hours * 3600 * 1000;
    rows = rows.filter(r => new Date(r.last_updated).getTime() >= cutoff);
  }
  if (!rows.length) { emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';

  const cap = cfg.capitalUsd || 10000;
  const lastIdx = rows.length - 1;
  const argosData = rows.map((r, idx) => {
    const realPnl = parseFloat(r.realized_pnl_usd || 0);
    const unrPnl  = idx === lastIdx ? state.clientUnrealizedPnl : parseFloat(r.unrealized_pnl_usd || 0);
    return cap > 0 ? ((realPnl + unrPnl) / cap) * 100 : 0;
  });

  // BTC comparison — 2 pasos: precio absoluto por fila → normalizar contra rows[0]
  const btcNowPx = livePrices['BTCUSDT']?.price || 0;
  let btcData;

  if (state.btcT0Price && btcNowPx > 0 && rows.length > 0) {
    const t0ms    = new Date(rows[0].last_updated).getTime();
    const tnMs    = new Date(rows[rows.length - 1].last_updated).getTime();
    const rangeMs = Math.max(1, tnMs - t0ms);

    // Paso 1: precio absoluto BTC para cada fila (sheet > klines > interpolación)
    const rawPx = rows.map(r => {
      const rowMs = new Date(r.last_updated).getTime();
      const s = parseFloat(r.btc_price || 0);
      if (s > 0) return s;
      const k = lookupBtcKline(state.btcKlines, rowMs);
      if (k > 0) return k;
      const frac = Math.max(0, Math.min(1, (rowMs - t0ms) / rangeMs));
      return state.btcT0Price + (btcNowPx - state.btcT0Price) * frac;
    });

    // Paso 2: normalizar → rawPx[0] siempre es la base (0%)
    const btcRef = rawPx[0];
    btcData = btcRef > 0
      ? rawPx.map(px => ((px - btcRef) / btcRef) * 100)
      : rows.map(() => null);
  } else {
    btcData = rows.map(() => null);
  }

  const labels = rows.map(r => fmtDatetime(r.last_updated));

  // Gradient fill
  const ctx = chart.ctx;
  const grad = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  grad.addColorStop(0, 'rgba(201,169,110,0.25)');
  grad.addColorStop(0.5, 'rgba(201,169,110,0.08)');
  grad.addColorStop(1, 'rgba(201,169,110,0.00)');
  chart.data.datasets[0].backgroundColor = grad;

  chart.data.labels = labels;
  chart.data.datasets[0].data = argosData;
  chart.data.datasets[1].data = btcData.every(v => v === null) ? [] : btcData;

  // Leyenda inline con los valores actuales
  const lastArgos = argosData[argosData.length - 1];
  const lastBtc   = btcData[btcData.length - 1];
  const la = document.getElementById('legend-argos-val');
  const lb = document.getElementById('legend-btc-val');
  if (la && lastArgos !== undefined) {
    la.textContent = fmtPct(lastArgos, true);
    la.style.color = lastArgos >= 0 ? 'var(--e-green)' : 'var(--e-red)';
  }
  if (lb && lastBtc !== null && lastBtc !== undefined) {
    lb.textContent = fmtPct(lastBtc, true);
    lb.style.color = lastBtc >= 0 ? 'var(--e-green)' : 'var(--e-red)';
  }

  // Escala Y adaptativa
  const allValues = [
    ...argosData.filter(v => v !== null && !isNaN(v)),
    ...btcData.filter(v => v !== null && !isNaN(v))
  ];
  if (allValues.length) {
    const dataMin = Math.min(...allValues);
    const dataMax = Math.max(...allValues);
    const range = dataMax - dataMin;
    const pad = Math.max(range * 0.15, 0.5);
    let yMin = dataMin - pad;
    let yMax = dataMax + pad;
    if (dataMin >= 0) yMin = Math.min(0, yMin);
    if (dataMax <= 0) yMax = Math.max(0, yMax);
    chart.options.scales.y.min = yMin;
    chart.options.scales.y.max = yMax;
  } else {
    chart.options.scales.y.min = -1;
    chart.options.scales.y.max =  1;
  }
  chart.update();
}

// ─────────────────────────────────────────
// DONUT CHART (unified composition with tabs)
// ─────────────────────────────────────────
// Helper: lighten a hex color
function lighten(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amt));
  const lg = Math.min(255, Math.round(g + (255 - g) * amt));
  const lb = Math.min(255, Math.round(b + (255 - b) * amt));
  return `rgb(${lr},${lg},${lb})`;
}

function makeDonutGradient(ctx, baseColor) {
  // Radial-ish gradient using linear for Chart.js arc fill
  const canvas = ctx.canvas;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r  = Math.min(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.3, cx, cy, r);
  grad.addColorStop(0, lighten(baseColor, 0.28));
  grad.addColorStop(0.55, baseColor);
  grad.addColorStop(1, lighten(baseColor, -0.2) === baseColor ? baseColor : baseColor);
  return grad;
}

function initDonut() {
  const el = document.getElementById('composition-donut');
  if (!el) return;
  const ctx = el.getContext('2d');

  // Plugin: glow/shadow por segmento
  const glowPlugin = {
    id: 'donutGlow',
    beforeDatasetDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.shadowColor   = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur    = 14;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 6;
    },
    afterDatasetDraw(chart) {
      chart.ctx.restore();
    }
  };

  state.donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: [], datasets: [{
      data: [],
      backgroundColor: [],
      borderWidth: 2,
      borderColor: 'rgba(3,14,27,0.95)',
      hoverOffset: 10,
      hoverBorderColor: 'rgba(201,169,110,0.8)',
      hoverBorderWidth: 2,
      spacing: 3,
      borderRadius: 6,
      borderAlign: 'inner',
    }]},
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '76%',
      radius: '92%',
      animation: { duration: 900, easing: 'easeOutCubic' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(6,19,36,0.98)',
          titleColor: '#C9A96E', bodyColor: '#F2EDE3',
          borderColor: 'rgba(201,169,110,0.25)', borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          titleFont: { size: 10, family: 'Inter', weight: 600 },
          bodyFont: { size: 11.5, family: 'JetBrains Mono', weight: 600 },
          displayColors: true,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            label: c => {
              const total = c.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((c.raw / total) * 100).toFixed(1) : '0.0';
              return `  ${c.label}: ${fmtMoney(c.raw)} (${pct}%)`;
            }
          }
        }
      }
    },
    plugins: [glowPlugin],
  });
}

function setPieSlide(idx) {
  state.pieSlide = idx;
  document.querySelectorAll('[data-pie]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.pie) === idx);
  });
  renderDonut();
}

function computeDonutItems(scope) {
  const motorStateArr = state.motorStateArr || [];
  // Fix 2026-04-23: usar portfolio total real en lugar de cfg.capitalUsd (que era 10000 hardcoded)
  const cap = (scope === 'total' && state.portfolioTotal > 0) ? state.portfolioTotal : (cfg.capitalUsd || 10000);
  const items = [];
  const colorMap = {};
  let deployed = 0;

  const pickColor = ticker => {
    if (!colorMap[ticker]) colorMap[ticker] = PIE_COLORS[Object.keys(colorMap).length % PIE_COLORS.length];
    return colorMap[ticker];
  };

  const addOrMerge = (ticker, val) => {
    if (val <= 0.01) return;
    const existing = items.find(i => i.label === ticker);
    if (existing) existing.value += val;
    else items.push({ label: ticker, value: val, color: pickColor(ticker) });
    deployed += val;
  };

  if (scope === 'trend') {
    const ms = motorStateArr.find(m => m.motor_id === 'trend');
    if (ms) {
      const basket = (ms.basket || {}).basket || {};
      Object.entries(basket).forEach(([sym, pos]) => {
        const ticker = sym.replace(/\/USDT$|\/BUSD$|\/USDC$|USDT$/, '');
        const qty = parseFloat(pos.qty || 0);
        const lp  = livePrices[sym.replace('/', '')] || livePrices[sym];
        const val = qty * (lp?.price || parseFloat(pos.avg_price || 0));
        addOrMerge(ticker, val);
      });
    }
  } else if (scope === 'grid') {
    const ms = motorStateArr.find(m => m.motor_id === 'spot_grid');
    if (ms) {
      const ag = (ms.basket || {}).active_grids || {};
      Object.entries(ag).forEach(([sym, g]) => {
        const ticker = sym.replace(/\/USDT$|\/BUSD$|\/USDC$/, '');
        const val = parseFloat(g.capital_usd || 0);
        addOrMerge(ticker, val);
      });
    }
  } else {
    // total: suma de todo
    motorStateArr.forEach(ms => {
      const basket = (ms.basket || {}).basket || {};
      Object.entries(basket).forEach(([sym, pos]) => {
        const ticker = sym.replace(/\/USDT$|\/BUSD$|\/USDC$|USDT$/, '');
        const qty = parseFloat(pos.qty || 0);
        const lp  = livePrices[sym.replace('/', '')] || livePrices[sym];
        const val = qty * (lp?.price || parseFloat(pos.avg_price || 0));
        addOrMerge(ticker, val);
      });
      const ag = (ms.basket || {}).active_grids || {};
      Object.entries(ag).forEach(([sym, g]) => {
        const ticker = sym.replace(/\/USDT$|\/BUSD$|\/USDC$/, '');
        const val = parseFloat(g.capital_usd || 0);
        addOrMerge(ticker, val);
      });
    });
  }

  // USDT libre
  let free = 0;
  if (scope === 'total') {
    free = Math.max(0, cap - deployed);
  } else {
    // USDT libre del motor
    const motorId = scope === 'trend' ? 'trend' : 'spot_grid';
    const row = state.allRows.find(r => r.motor_id === motorId) ||
                [...state.allRows].reverse().find(r => r.motor_id === motorId);
    const alloc = row ? parseFloat(row.capital_allocated_usd || 0) : 0;
    free = Math.max(0, alloc - deployed);
  }
  if (free > 0.01) items.push({ label: 'USDT libre', value: free, color: USDT_COLOR });

  items.sort((a, b) => b.value - a.value);
  return { items, deployed };
}

function renderDonut() {
  if (!state.donutChart) return;
  const scope = state.pieSlide === 1 ? 'trend' : state.pieSlide === 2 ? 'grid' : 'total';
  const titles = ['Cartera Agregada', 'Motor 1 — Trend', 'Motor 2 — Spot Grid'];
  const subs = ['Distribución total', 'Dual Momentum', 'Grid activos'];
  document.getElementById('pie-slide-title').textContent = titles[state.pieSlide];
  document.getElementById('pie-slide-sub').textContent = subs[state.pieSlide];

  const { items, deployed } = computeDonutItems(scope);
  const total = items.reduce((s, i) => s + i.value, 0);

  const chart = state.donutChart;
  const ctx2d = chart.ctx;
  chart.data.labels = items.map(i => i.label);
  chart.data.datasets[0].data = items.map(i => i.value);
  // Gradientes radiales brillantes por segmento
  chart.data.datasets[0].backgroundColor = items.map(i => makeDonutGradient(ctx2d, i.color));
  chart.data.datasets[0].hoverBackgroundColor = items.map(i => lighten(i.color, 0.18));
  // Guarda colores base para la leyenda (CSS usa currentColor en el dot)
  chart._baseColors = items.map(i => i.color);
  chart.update();

  // Center labels
  document.getElementById('donut-center-label').textContent =
    scope === 'total' ? 'TOTAL' : scope === 'trend' ? 'TREND' : 'GRID';
  document.getElementById('donut-center-value').textContent = fmtMoneyCompact(total);
  document.getElementById('donut-center-sub').textContent =
    items.length > 1 ? items.length - 1 + ' activos + USDT' : items.length + ' activo' + (items.length === 1 ? '' : 's');

  // Legend
  const leg = document.getElementById('composition-legend');
  leg.innerHTML = items.length ? items.map(i => {
    const pct = total > 0 ? ((i.value / total) * 100).toFixed(1) : '0.0';
    return `
      <div class="cleg-row">
        <span class="cleg-dot" style="background:${i.color};color:${i.color}"></span>
        <span class="cleg-label">${i.label}</span>
        <span class="cleg-pct">${pct}%</span>
      </div>`;
  }).join('') : '<div class="empty-sub">Sin datos</div>';
}

// ─────────────────────────────────────────
// MOTORS & POSITIONS
// ─────────────────────────────────────────
window._logoErr = function(img, sym, ticker, size) {
  if (!img._triedCoincap) {
    img._triedCoincap = true;
    img.src = 'https://assets.coincap.io/assets/icons/' + sym + '@2x.png';
  } else {
    var fs = Math.round(size * 0.38);
    img.parentNode.innerHTML = '<span style="font-size:' + fs + 'px;font-weight:700;color:#9A7A48">' + ticker.slice(0, 3) + '</span>';
  }
};

function coinLogoHtml(ticker, size) {
  size = Math.round((size || 28) * 0.95);
  const sym = ticker.toLowerCase();
  return `<span class="coin-logo" style="width:${size}px;height:${size}px">
    <img src="https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/32/color/${sym}.png"
         style="width:${size}px;height:${size}px" loading="lazy"
         onerror="window._logoErr(this,'${sym}','${ticker}',${size})">
  </span>`;
}

function renderMotors(allRows, motorStateArr) {
  const motorMap = {};
  (allRows || []).forEach(r => { if (r.motor_id) motorMap[r.motor_id] = r; });

  const basketMap = {};
  const gridMap   = {};
  (motorStateArr || []).forEach(ms => {
    if (!ms.motor_id) return;
    const b = ms.basket || {};
    basketMap[ms.motor_id] = b.basket || {};
    if (b.active_grids) gridMap[ms.motor_id] = b.active_grids;
  });

  const container = document.getElementById('motors-list');
  container.innerHTML = MOTORS_DEF.map(m => {
    const row       = motorMap[m.id];
    const basket    = basketMap[m.id] || {};
    const isActive  = !!row;
    const status    = row?.status || 'stub';
    const allocated = parseFloat(row?.capital_allocated_usd || 0);
    const pnl       = parseFloat(row?.realized_pnl_usd || 0);
    const syms      = Object.keys(basket);
    const cap       = cfg.capitalUsd || 10000;
    const utilPct   = cap > 0 ? (allocated / cap * 100).toFixed(0) : 0;

    const badgeCls = isActive && status === 'running' ? 'running' :
                     status === 'error' ? 'error' : 'stub';
    const badgeTxt = isActive ? status.toUpperCase() : 'STUB';

    const deployed = parseFloat(row?.capital_deployed_usd || 0);
    const allocPct = cap > 0 ? Math.min(100, (allocated / cap) * 100) : 0;
    const depPct   = cap > 0 ? Math.min(100, (deployed  / cap) * 100) : 0;

    // Fix 2026-04-23: capital reservado para motores stub (M3/M4) según RISK_ON 10k
    const STUB_ALLOC_PCT = { perp_grid: 0.20, funding_arb: 0.15 };
    const totalCapFull   = state.totalCapital || cap;
    const stubReserved   = !isActive && STUB_ALLOC_PCT[m.id] ? STUB_ALLOC_PCT[m.id] * totalCapFull : 0;
    const stubResPct     = totalCapFull > 0 ? Math.min(100, (stubReserved / totalCapFull) * 100) : 0;

    const headHtml = `
      <div class="motor-row-head">
        <div class="motor-info">
          <span class="motor-title${isActive ? '' : ' dim'}">${m.label}</span>
          <span class="motor-desc">${m.desc}</span>
          ${isActive && allocated > 0 ? `
            <div class="motor-alloc-bar" title="Capital asignado / desplegado">
              <div class="mab-alloc" style="width:${allocPct}%"></div>
              <div class="mab-deployed" style="width:${depPct}%"></div>
            </div>
            <div class="motor-alloc-legend">
              <span class="mal-dot mal-dot-alloc"></span><span>${fmtMoneyCompact(allocated)} alloc</span>
              <span class="mal-sep">·</span>
              <span class="mal-dot mal-dot-dep"></span><span>${fmtMoneyCompact(deployed)} deployed</span>
            </div>
          ` : stubReserved > 0 ? `
            <div class="motor-alloc-bar" title="Capital reservado (motor en preparación)" style="opacity:0.45">
              <div class="mab-alloc" style="width:${stubResPct}%"></div>
            </div>
            <div class="motor-alloc-legend" style="opacity:0.55">
              <span class="mal-dot mal-dot-alloc"></span><span>${fmtMoneyCompact(stubReserved)} reservado · parked</span>
            </div>
          ` : ''}
        </div>
        <div class="motor-meta">
          <div class="motor-meta-top">
            ${isActive && allocated > 0 ? `<span class="motor-util">${utilPct}%</span>` : ''}
            <span class="ma-status ${badgeCls}">${badgeTxt}</span>
          </div>
          ${isActive ? `
            <span class="motor-alloc-str">${m.id === 'spot_grid' ? (row.open_positions || 0) : syms.length} posiciones</span>
            <span class="motor-pnl-str ${clsFor(pnl)}">PnL ${fmtMoney(pnl, true)}</span>
          ` : stubReserved > 0 ? `
            <span class="motor-alloc-str" style="opacity:0.5">${(STUB_ALLOC_PCT[m.id]*100).toFixed(0)}% capital</span>
          ` : ''}
        </div>
      </div>`;

    // Spot Grid
    if (m.id === 'spot_grid') {
      const activeGrids = gridMap['spot_grid'] || {};
      const gridSymbols = Object.keys(activeGrids);

      let body = '';
      if (!isActive || allocated === 0) {
        body = `<div class="empty-sub">⏳ Activa cuando capital Argos ≥ 5.000 $</div>`;
      } else if (gridSymbols.length === 0) {
        body = `<div class="empty-sub">Buscando pares en chop (ER·ADX·BBW)…</div>`;
      } else {
        body = `
          <div class="grid-header">
            <span>Par</span>
            <span>Rango BB</span>
            <span>Niveles</span>
            <span>Capital</span>
            <span>PnL Real.</span>
          </div>` + gridSymbols.map(sym => {
          const g = activeGrids[sym];
          const lower = parseFloat(g.lower || 0);
          const upper = parseFloat(g.upper || 0);
          const levels = (g.levels || []).length;
          const filled = Object.keys(g.positions || {}).length;
          const capG = parseFloat(g.capital_usd || 0);
          const pnlG = parseFloat(g.pnl_realized_usd || 0);
          const ticker = sym.replace(/\/USDT$|\/BUSD$|\/USDC$|USDT$/, '');
          const lp = livePrices[sym.replace('/', '')] || livePrices[sym];
          const curPrice = lp?.price || parseFloat(g.last_price || 0);

          const pos = (upper > lower && curPrice > 0) ? Math.max(0, Math.min(1, (curPrice - lower) / (upper - lower))) : 0.5;
          const dev = pos - 0.5;
          const barPct = Math.abs(dev) * 100;
          const fillCls = dev >= 0 ? 'up' : 'down';

          return `
          <div class="grid-row">
            <div class="grid-asset">
              ${coinLogoHtml(ticker, 22)}
              <div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--e-bone)">${ticker}</div>
                ${curPrice ? `<div style="font-size:0.64rem;color:var(--e-faint);font-family:var(--f-mono)">${fmtPrice(curPrice)}</div>` : ''}
              </div>
            </div>
            <div style="text-align:center">
              <div class="mono" style="font-size:0.7rem;font-weight:600;color:var(--e-bone-dim)">${fmtPrice(lower)} – ${fmtPrice(upper)}</div>
              <div class="grid-range">
                <div class="grid-range-fill ${fillCls}" style="${dev >= 0 ? 'left:50%;width:' + barPct + '%' : 'right:50%;width:' + barPct + '%'}"></div>
                <div class="grid-range-centerline"></div>
              </div>
              <div style="font-size:0.6rem;color:var(--e-faint);margin-top:3px">${filled}/${levels} llenados</div>
            </div>
            <div style="text-align:right" class="mono">${levels}</div>
            <div style="text-align:right" class="mono" style="color:var(--e-bone)">${fmtMoneyCompact(capG)}</div>
            <div style="text-align:right" class="mono ${clsFor(pnlG)}">${fmtMoney(pnlG, true)}</div>
          </div>`;
        }).join('');
      }
      return `<div class="motor-block">${headHtml}${body}</div>`;
    }

    // Standard motors (trend etc.)
    const posBody = syms.length > 0 ? `
      <div class="pos-table">
        <div class="pos-header">
          <span>Activo</span>
          <span>Precio</span>
          <span>Holdings</span>
          <span>Reval %</span>
        </div>
        ${syms.map(sym => {
          const pos = basket[sym];
          const avgPrice = parseFloat(pos.avg_price || 0);
          const qty = parseFloat(pos.qty || 0);
          const bybitSym = sym.replace('/', '');
          const ticker = sym.replace(/\/USDT$|\/BUSD$|\/USDC$|USDT$|BUSD$|USDC$/, '');
          const lp = livePrices[bybitSym] || livePrices[sym];
          const livePrice = lp?.price || 0;
          const chg24h = lp?.chg24h ?? null;
          const holdValue = qty * livePrice;
          const retPct = avgPrice > 0 && livePrice > 0 ? ((livePrice - avgPrice) / avgPrice) * 100 : null;
          const retCls = retPct === null ? 'neu' : retPct > 0 ? 'up' : retPct < 0 ? 'down' : 'neu';
          const chgCls = chg24h === null ? 'neu' : chg24h > 0 ? 'up' : chg24h < 0 ? 'down' : 'neu';
          const holdFmt = livePrice > 0 ? fmtMoneyCompact(holdValue) : '—';
          const retFmt = retPct !== null ? fmtPct(retPct, true) : '—';
          const chgFmt = chg24h !== null ? (chg24h >= 0 ? '▲ ' : '▼ ') + Math.abs(chg24h).toFixed(2) + '%' : '';
          const qtyFmt = qty >= 1 ? qty.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : qty.toLocaleString('de-DE', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
          const entryDate = pos.entry_date ? fmtDatetime(pos.entry_date) : '—';

          return `
          <div class="pos-row">
            <div class="pos-asset">
              ${coinLogoHtml(ticker, 28)}
              <span class="coin-ticker">${ticker}</span>
            </div>
            <div class="pos-col">
              <div class="pos-val">${fmtPrice(livePrice)}</div>
              ${chgFmt ? `<div class="pos-delta ${chgCls}">${chgFmt}</div>` : '<div style="height:18px"></div>'}
            </div>
            <div class="pos-col">
              <div class="pos-val">${holdFmt}</div>
              <div class="pos-sub">${qtyFmt} ${ticker}</div>
            </div>
            <div class="pos-col">
              <div class="pos-val ${retCls === 'up' ? 'price-up' : retCls === 'down' ? 'price-down' : ''}">${retFmt}</div>
              <div class="pos-sub">${entryDate}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`
    : (isActive ? `<div class="empty-sub">Sin posiciones abiertas</div>` : '');

    return `<div class="motor-block">${headHtml}${posBody}</div>`;
  }).join('');
}

// ─────────────────────────────────────────
// CYCLE HISTORY
// ─────────────────────────────────────────
function renderCycleHistory(rows) {
  const container = document.getElementById('cycle-list');
  const countLabel = document.getElementById('cycle-count-label');
  const dryBadge = document.getElementById('dry-run-badge');

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><span>Sin ciclos todavía</span></div>';
    countLabel.textContent = '—';
    return;
  }

  countLabel.textContent = rows.length + ' ciclos';
  const lastMode = (rows[rows.length - 1]?.mode || '').toUpperCase();
  const modeMap = {
    DRY_RUN: { color: 'var(--e-amber)', bg: 'var(--e-amber-bg)', bd: 'rgba(245,158,11,0.4)', txt: 'DRY RUN' },
    TESTNET: { color: 'var(--e-green)', bg: 'var(--e-green-bg)', bd: 'rgba(13,179,117,0.4)', txt: 'TESTNET' },
    LIVE:    { color: 'var(--e-red)',   bg: 'var(--e-red-bg)',   bd: 'rgba(232,64,64,0.4)',  txt: 'LIVE' },
  };
  if (modeMap[lastMode]) {
    const m = modeMap[lastMode];
    dryBadge.textContent = m.txt;
    dryBadge.style.color = m.color;
    dryBadge.style.background = m.bg;
    dryBadge.style.borderColor = m.bd;
    dryBadge.style.display = 'inline-flex';
  } else {
    dryBadge.style.display = 'none';
  }

  const display = [...rows].reverse().slice(0, 50);
  const regimeColor = { risk_on: 'var(--e-green)', risk_off: 'var(--e-amber)', stand_down: 'var(--e-red)' };

  container.innerHTML = display.map(r => {
    const rc = regimeColor[(r.regime || '').toLowerCase()] || 'var(--e-muted)';
    const pnl = parseFloat(r.realized_pnl_usd || 0);
    const pnlCls = clsFor(pnl) === 'up' ? 'price-up' : clsFor(pnl) === 'down' ? 'price-down' : 'price-neu';
    const err = r.last_error
      ? `<span style="color:var(--e-red)">⚠</span>`
      : `<span style="color:var(--e-green)">✓</span>`;
    return `
    <div class="cycle-row">
      <span class="mono" style="color:var(--e-muted)">${fmtDatetime(r.last_updated)}</span>
      <span class="mono" style="color:var(--e-faint);font-size:0.64rem">${(r.cycle_id || '—').slice(-10)}</span>
      <span style="color:var(--e-bone-dim)">${r.motor_id || '—'}</span>
      <span style="color:${rc};font-weight:600;font-size:0.66rem;letter-spacing:0.06em">${(r.regime || '—').replace('_', ' ').toUpperCase()}</span>
      <span class="cycle-col-hide mono" style="color:var(--e-bone-dim)">${fmtMoneyCompact(r.capital_allocated_usd || 0)}</span>
      <span class="cycle-col-hide mono" style="color:var(--e-muted)">${fmtMoneyCompact(r.capital_deployed_usd || 0)}</span>
      <span class="cycle-col-hide mono ${pnlCls}">${fmtMoney(pnl, true)}</span>
      <span style="color:var(--e-bone-dim)">${err} ${r.status || '—'}</span>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
// BENCHMARK KPIs — strip de 5 cards
// ─────────────────────────────────────────
function renderBenchmarkKPIs() {
  return; // Strip eliminado del dashboard — datos ya presentes en hero y benchmark KPIs
  const strip = document.getElementById('bm-strip');
  if (!strip) return;

  const bmRows = state.benchmarkRows || [];
  const cfg2   = state.benchmarkConfig || {};

  if (!bmRows.length || !cfg2.capital_0) {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = '';

  const last      = bmRows[bmRows.length - 1];
  const capital0  = parseFloat(cfg2.capital_0  || 0);
  const btc0      = parseFloat(cfg2.btc_0      || 0);
  const t0label   = (cfg2.t_0 || '—').slice(0, 10);
  const equityNow = parseFloat(last.argos_equity   || 0);
  const argosRet  = parseFloat(last.argos_return_pct || 0);
  const btcRet    = parseFloat(last.btc_return_pct   || 0);
  const alphaVal  = parseFloat(last.alpha_pp          || 0);
  const nciclos   = bmRows.length;

  const col = v => v > 0 ? 'var(--e-green)' : v < 0 ? 'var(--e-red)' : 'var(--e-bone)';

  strip.innerHTML = `
    <div class="bm-card">
      <span class="bm-label">Capital<sub>0</sub></span>
      <span class="bm-val">${fmtMoney(capital0)}</span>
      <span class="bm-sub mono">${t0label}</span>
    </div>
    <div class="bm-card">
      <span class="bm-label">Equity actual</span>
      <span class="bm-val">${equityNow > 0 ? fmtMoney(equityNow) : '—'}</span>
      <span class="bm-sub mono">${nciclos} ciclos</span>
    </div>
    <div class="bm-card">
      <span class="bm-label">Return Argos</span>
      <span class="bm-val" style="color:${col(argosRet)}">${fmtPct(argosRet, true)}</span>
      <span class="bm-sub mono">desde t₀</span>
    </div>
    <div class="bm-card">
      <span class="bm-label">BTC Hold</span>
      <span class="bm-val" style="color:${col(btcRet)}">${fmtPct(btcRet, true)}</span>
      <span class="bm-sub mono">BTC₀ ${btc0 > 0 ? fmtMoneyCompact(btc0) : '—'}</span>
    </div>
    <div class="bm-card bm-card-alpha" style="border-color:${alphaVal >= 0 ? 'rgba(201,169,110,0.35)' : 'rgba(232,64,64,0.3)'}">
      <span class="bm-label">Alpha vs BTC</span>
      <span class="bm-val bm-alpha" style="color:${col(alphaVal)}">${fmtPct(alphaVal, true)}</span>
      <span class="bm-sub mono">${alphaVal >= 0 ? '▲ Argos gana' : '▼ BTC gana'}</span>
    </div>`;
}

// ─────────────────────────────────────────
// ALPHA CARD — KPI prominente bajo el gráfico
// ─────────────────────────────────────────
function renderAlphaCard() {
  const el = document.getElementById('alpha-kpi-card');
  if (!el) return;

  const bmRows = state.benchmarkRows || [];
  const cfg2   = state.benchmarkConfig || {};
  if (!bmRows.length) { el.style.display = 'none'; return; }

  el.style.display = '';
  const last     = bmRows[bmRows.length - 1];
  const alphaVal = parseFloat(last.alpha_pp || 0);
  const t0label  = (cfg2.t_0 || '').replace('T', ' ').slice(0, 16) + ' UTC';
  const nciclos  = bmRows.length;
  const isPos    = alphaVal >= 0;

  el.innerHTML = `
    <div class="alpha-inner" style="border-color:${isPos ? 'rgba(201,169,110,0.4)' : 'rgba(232,64,64,0.35)'}">
      <div class="alpha-left">
        <span class="eyebrow">Alpha vs BTC Hold</span>
        <div class="alpha-big" style="color:${isPos ? 'var(--e-gold)' : 'var(--e-red)'}">${fmtPct(alphaVal, true)} <span class="alpha-unit">pp</span></div>
        <span class="alpha-sub mono">desde ${t0label} · ${nciclos} ciclos</span>
      </div>
      <div class="alpha-right">
        <div class="alpha-stat">
          <span class="alpha-stat-label">Argos</span>
          <span class="alpha-stat-val ${parseFloat(last.argos_return_pct||0)>=0?'up':'down'}">${fmtPct(parseFloat(last.argos_return_pct||0),true)}</span>
        </div>
        <div class="alpha-divider"></div>
        <div class="alpha-stat">
          <span class="alpha-stat-label">BTC Hold</span>
          <span class="alpha-stat-val ${parseFloat(last.btc_return_pct||0)>=0?'up':'down'}">${fmtPct(parseFloat(last.btc_return_pct||0),true)}</span>
        </div>
      </div>
    </div>`;
}
