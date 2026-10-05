// src/utils/budgetAlerts.js
import * as Notifications from 'expo-notifications';
import { getData, saveData } from './storage';
import { getBudgets, THIS_MONTH, monthKey } from './budgets';
import { normalizeWalletTiles, canonicalizeCategory } from './categoryTilesGuard';

const FIRED_KEY = 'budget_alerts_fired_v1'; // { month: 'YYYY-MM', log: { [capKeyLevel]: ISO } }

// --- date helpers ---
const two = (n) => (n < 10 ? `0${n}` : `${n}`);
const daysInMonth = (d = new Date()) => {
  const y = d.getFullYear(); const m = d.getMonth();
  return new Date(y, m + 1, 0).getDate();
};
const todayDay = () => new Date().getDate();

// --- fired registry ---
async function loadFired() {
  const d = (await getData(FIRED_KEY)) || {};
  if (d.month !== THIS_MONTH) return { month: THIS_MONTH, log: {} };
  return d;
}
async function saveFired(obj) {
  await saveData(FIRED_KEY, obj);
}
async function markFired(key) {
  const reg = await loadFired();
  reg.log[key] = new Date().toISOString();
  await saveFired(reg);
}
async function shouldFire(key, cooldownHours) {
  const reg = await loadFired();
  const ts = reg.log?.[key];
  if (!ts) return true;
  const prev = new Date(ts).getTime();
  const now = Date.now();
  return (now - prev) >= cooldownHours * 3600 * 1000;
}

// --- push helper ---
async function notifyNow(title, body) {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // immediate
    });
  } catch {
    // swallow
  }
}

// --- tally this-month spending (wallets + optional payables history + legacy bills) ---
// Also returns wallets + a precomputed map of each wallet's canonical tiles, so we can check per-tile caps.
async function computeTallies({ includeBills }) {
  const wallets = (await getData('wallets')) || [];
  const payables = (await getData('payables_v1')) || [];
  const legacyBills = (await getData('bills')) || [];

  const perWallet = {};    // { [walletId]: { name, total, byCategory: {'Food & Drink': sum} } }
  const global = { total: 0, byCategory: {} };
  const walletCanonTiles = {}; // { [walletId]: { [tileId]: canonicalTitle } }

  // init
  for (const w of wallets) {
    const tiles = normalizeWalletTiles(w.tiles || []);
    perWallet[w.id] = { name: w.name, total: 0, byCategory: {} };
    walletCanonTiles[w.id] = {};
    for (const t of tiles) {
      walletCanonTiles[w.id][t.id] = canonicalizeCategory(t.title, tiles);
    }
  }

  // wallet expenses (this month)
  for (const w of wallets) {
    const tiles = normalizeWalletTiles(w.tiles || []);
    for (const e of (w.expenses || [])) {
      if (!e?.date) continue;
      if (monthKey(e.date) !== THIS_MONTH) continue;
      const amt = Number(e.amount || 0);
      const category = canonicalizeCategory(e.category || 'Others', tiles);
      perWallet[w.id].total += amt;
      perWallet[w.id].byCategory[category] = (perWallet[w.id].byCategory[category] || 0) + amt;
      global.total += amt;
      global.byCategory[category] = (global.byCategory[category] || 0) + amt;
    }
  }

  if (includeBills) {
    // payables history (paid entries only)
    for (const p of (payables || [])) {
      for (const h of (p.history || [])) {
        if (!h?.date) continue;
        if (monthKey(h.date) !== THIS_MONTH) continue;
        const amt = Number(h.amount || 0);
        const walletId = p.walletId || null;
        const w = wallets.find((x) => x.id === walletId) || null;
        const tiles = normalizeWalletTiles(w?.tiles || []);
        const category = canonicalizeCategory(p.category || 'Home Bills', tiles);
        if (w) {
          perWallet[w.id].total += amt;
          perWallet[w.id].byCategory[category] = (perWallet[w.id].byCategory[category] || 0) + amt;
        }
        global.total += amt;
        global.byCategory[category] = (global.byCategory[category] || 0) + amt;
      }
    }
    // legacy bills (paid=true)
    for (const b of (legacyBills || [])) {
      if (!b.paid) continue;
      if (!b?.dueDate || monthKey(b.dueDate) !== THIS_MONTH) continue;
      const amt = Number(b.amount || 0);
      const walletId = b.walletId || null;
      const w = wallets.find((x) => x.id === walletId) || null;
      const tiles = normalizeWalletTiles(w?.tiles || []);
      const category = canonicalizeCategory(b.title || 'Home Bills', tiles);
      if (w) {
        perWallet[w.id].total += amt;
        perWallet[w.id].byCategory[category] = (perWallet[w.id].byCategory[category] || 0) + amt;
      }
      global.total += amt;
      global.byCategory[category] = (global.byCategory[category] || 0) + amt;
    }
  }

  return { perWallet, global, wallets, walletCanonTiles };
}

// --- evaluate caps -> notifications ---
function fmtPeso(n) { return `₱${Number(n || 0).toFixed(0)}`; }

// Builds a nice title/body and returns {fired, alertsAdded}
async function evaluateAndNotify({ budgets, tallies, forecast = false }) {
  const cooldown = Number(budgets.flags?.cooldownHours || 12);
  const thresholds = (budgets.flags?.thresholds || [0.5, 0.8, 1.0, 1.1]).map(Number).sort((a,b)=>a-b);

  const alerts = [];

  // helper for threshold logic
  async function testCap({ capId, titleCtx, spent, cap }) {
    if (!cap || cap <= 0) return 0;
    const ratio = spent / cap;
    const pct = Math.round(ratio * 100);
    let firedHere = 0;

    // thresholds
    for (const t of thresholds) {
      if (ratio >= t) {
        const levelPct = Math.round(t * 100);
        const key = `${capId}:thr:${levelPct}:${THIS_MONTH}`;
        if (await shouldFire(key, cooldown)) {
          const msgTitle =
            levelPct < 100 ? `Budget ${levelPct}% — ${titleCtx}` :
            levelPct === 100 ? `Budget reached — ${titleCtx}` :
            `Over budget — ${titleCtx}`;
          const over = Math.max(0, spent - cap);
          const body =
            levelPct < 100
              ? `Used ${fmtPeso(spent)} of ${fmtPeso(cap)} (${pct}%).`
              : `Over by ${fmtPeso(over)}. Used ${fmtPeso(spent)} of ${fmtPeso(cap)}.`;

          await notifyNow(msgTitle, body);
          alerts.push({ capId, level: t, title: msgTitle, body });
          await markFired(key);
          firedHere++;
        }
      }
    }

    // forecast (run-rate)
    if (forecast) {
      const days = daysInMonth();
      const avgPerDay = spent / Math.max(1, todayDay());
      const projected = avgPerDay * days;
      if (projected > cap * 1.05) {
        const keyP = `${capId}:proj:${THIS_MONTH}`;
        if (await shouldFire(keyP, cooldown)) {
          const body = `At this pace ~${fmtPeso(projected)} vs cap ${fmtPeso(cap)}. Consider trimming to avoid an overrun.`;
          const title = `Likely to exceed — ${titleCtx}`;
          await notifyNow(title, body);
          alerts.push({ capId, level: 1.05, title, body });
          await markFired(keyP);
          firedHere++;
        }
      }
    }

    return firedHere;
  }

  // ========== 1) WALLET + WALLET+CATEGORY caps from budgets ==========
  for (const [walletId, wObj] of Object.entries(budgets.byWallet || {})) {
    const wTall = tallies.perWallet[walletId];
    if (!wTall) continue;
    const wName = wTall.name || 'Wallet';

    // wallet total cap (budgets store)
    if (wObj.walletCap) {
      await testCap({
        capId: `bud:w:${walletId}`,
        titleCtx: `${wName} (total)`,
        spent: Number(wTall.total || 0),
        cap: Number(wObj.walletCap || 0),
      });
    }
    // per-category caps inside wallet (budgets store)
    for (const [cat, cap] of Object.entries(wObj.byCategory || {})) {
      if (!cap) continue;
      const spent = Number(wTall.byCategory?.[cat] || 0);
      await testCap({
        capId: `bud:wc:${walletId}:${cat}`,
        titleCtx: `${wName} • ${cat}`,
        spent,
        cap: Number(cap),
      });
    }
  }

  // ========== 2) GLOBAL caps from budgets ==========
  if (budgets.global?.totalCap) {
    await testCap({
      capId: `bud:g:total`,
      titleCtx: `All Wallets (total)`,
      spent: Number(tallies.global.total || 0),
      cap: Number(budgets.global.totalCap || 0),
    });
  }
  for (const [cat, cap] of Object.entries(budgets.global?.byCategory || {})) {
    if (!cap) continue;
    const spent = Number(tallies.global.byCategory?.[cat] || 0);
    await testCap({
      capId: `bud:gc:${cat}`,
      titleCtx: `All Wallets • ${cat}`,
      spent,
      cap: Number(cap),
    });
  }

  // ========== 3) Caps stored directly on wallet / tile ==========
  // Only check these if there is no overlapping budgets cap for the same scope to avoid double alerts.
  const wallets = tallies.wallets || [];
  for (const w of wallets) {
    const wTall = tallies.perWallet[w.id];
    if (!wTall) continue;
    const wName = wTall.name || 'Wallet';

    // Wallet-level cap on the wallet object
    const hasBudgetWalletCap = !!(budgets.byWallet?.[w.id]?.walletCap);
    if (!hasBudgetWalletCap && Number(w.monthlyCap || 0) > 0) {
      await testCap({
        capId: `wal:w:${w.id}`,
        titleCtx: `${wName} (total)`,
        spent: Number(wTall.total || 0),
        cap: Number(w.monthlyCap),
      });
    }

    // Per-tile caps on the wallet's tiles
    const tiles = normalizeWalletTiles(w.tiles || []);
    const catMap = wTall.byCategory || {};
    const alreadyBudgetedCats = new Set(Object.keys(budgets.byWallet?.[w.id]?.byCategory || {}));

    for (const t of tiles) {
      const capRaw = t?.cap;
      if (!capRaw || Number(capRaw) <= 0) continue;
      const canonical = canonicalizeCategory(t.title, tiles);

      // If a budgets cap exists for this canonical category, skip the tile cap to avoid duplicates
      if (alreadyBudgetedCats.has(canonical)) continue;

      const spent = Number(catMap[canonical] || 0);
      await testCap({
        capId: `wal:wc:${w.id}:${canonical}`,
        titleCtx: `${wName} • ${canonical}`,
        spent,
        cap: Number(capRaw),
      });
    }
  }

  return { alerts };
}

// --- public API ---

/** Recompute ONLY what's needed after a new expense/bill and push alerts. Returns { alerts } for in-app toasts. */
export async function checkAndNotifyAfterExpense() {
  const budgets = await getBudgets();
  const tallies = await computeTallies({ includeBills: !!budgets.flags?.includeBills });
  return await evaluateAndNotify({ budgets, tallies, forecast: false });
}

/** Daily/activation sweep with run-rate projection. Returns { alerts } (if any fired during sweep). */
export async function runBudgetSweep() {
  const budgets = await getBudgets();
  const tallies = await computeTallies({ includeBills: !!budgets.flags?.includeBills });
  return await evaluateAndNotify({ budgets, tallies, forecast: true });
}
