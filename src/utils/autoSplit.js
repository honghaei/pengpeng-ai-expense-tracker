// src/utils/autoSplit.js
import { getData, saveData } from './storage';
import { transferFromTotalToWallet, getTotalBalance } from './ledger';

/**
 * Storage shape (percent-based only):
 * KEY = 'wallet_auto_split'
 * {
 *   allocationsPct: { [walletId]: number }, // 0..100 per wallet
 *   lastApplied: { ["YYYY-MM-<day>"]: true } // one stamp per actual payday day-of-month
 * }
 */
const KEY = 'wallet_auto_split';

export async function loadAutoSplit() {
  const cfg = (await getData(KEY)) || {};
  return {
    allocationsPct: { ...(cfg.allocationsPct || {}) },
    lastApplied: { ...(cfg.lastApplied || {}) },
  };
}

export async function saveAutoSplit(next) {
  const cur = await loadAutoSplit();
  const allocationsPct = {};
  Object.entries(next.allocationsPct || {}).forEach(([id, v]) => {
    const pct = Math.max(0, Math.min(100, Number(v) || 0));
    allocationsPct[id] = pct;
  });
  const merged = { ...cur, allocationsPct };
  await saveData(KEY, merged);
  return merged;
}

function stampFor(date, dayOfMonth) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(dayOfMonth).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Utility: compute amounts by pct with rounding fix on the last wallet. */
function computeSplitAmounts(baseAmount, pctMap, orderedIds) {
  const base = Math.max(0, Number(baseAmount) || 0);
  const entries = Object.entries(pctMap || {}).filter(([, p]) => Number(p) > 0);
  if (!entries.length || base <= 0) return {};
  const ordered = orderedIds?.length
    ? entries.sort((a, b) => orderedIds.indexOf(a[0]) - orderedIds.indexOf(b[0]))
    : entries;

  let allocated = 0;
  const out = {};
  for (let i = 0; i < ordered.length; i++) {
    const [id, pct] = ordered[i];
    if (i === ordered.length - 1) {
      out[id] = +(base - allocated).toFixed(2);
    } else {
      const amt = +(base * (Number(pct) / 100)).toFixed(2);
      out[id] = amt;
      allocated += amt;
    }
  }
  Object.keys(out).forEach((k) => { if (!(out[k] > 0)) delete out[k]; });
  return out;
}

/**
 * Run on Wallets screen focus (or any daily job).
 * - Reads paydays from user_profile.autoIncome.days (and requires autoIncome.enabled).
 * - If today is one of those days and not already applied this month for that day, it splits.
 */
export async function maybeRunAutoSplitToday() {
  const profile = (await getData('user_profile')) || {};
  const enabled = !!profile?.autoIncome?.enabled;
  const daysRaw = Array.isArray(profile?.autoIncome?.days)
    ? profile.autoIncome.days
    : (profile?.autoIncome?.dayOfMonth ? [profile.autoIncome.dayOfMonth] : []);

  if (!enabled || !daysRaw.length) return { ran: false, reason: 'no-paydays' };

  const days = [...new Set(daysRaw.map((n) => Number(n)).filter((n) => n >= 1 && n <= 31))].sort((a, b) => a - b);
  if (!days.length) return { ran: false, reason: 'bad-days' };

  const today = new Date();
  const todayNum = today.getDate();
  if (!days.includes(todayNum)) return { ran: false, reason: 'not-payday' };

  const cfg = await loadAutoSplit();
  const stamp = stampFor(today, todayNum);
  if (cfg.lastApplied?.[stamp]) return { ran: false, reason: 'already-applied' };

  const monthlyIncome = Number(profile?.monthlyIncome || 0);
  if (!(monthlyIncome > 0)) return { ran: false, reason: 'no-income' };

  const pcts = cfg.allocationsPct || {};
  const pctSum = Object.values(pcts).reduce((s, v) => s + (Number(v) || 0), 0);
  if (!(pctSum > 0)) return { ran: false, reason: 'no-percentages' };
  if (pctSum > 100.0001) return { ran: false, reason: 'pct-over-100' };

  const baseForToday = monthlyIncome / days.length;
  const totalNow = await getTotalBalance();
  const budget = Math.min(baseForToday, totalNow);
  if (!(budget > 0)) return { ran: false, reason: 'no-cash' };

  const wallets = (await getData('wallets')) || [];
  const order = wallets.map((w) => w.id);
  const amounts = computeSplitAmounts(budget, pcts, order);

  let moved = 0;
  for (const [walletId, amt] of Object.entries(amounts)) {
    const res = await transferFromTotalToWallet(walletId, amt);
    if (res?.ok) moved += amt;
  }

  const lastApplied = { ...(cfg.lastApplied || {}), [stamp]: true };
  await saveData(KEY, { ...cfg, lastApplied });

  return { ran: moved > 0, moved, stamp };
}
