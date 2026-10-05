import { getData, saveData } from './storage';

const KEY = 'budgets_v1';

const two = (n) => (n < 10 ? `0${n}` : `${n}`);
export const monthKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${two(x.getMonth() + 1)}`;
};
export const THIS_MONTH = monthKey();

function defaultBudgets(flags = {}) {
  return {
    monthKey: THIS_MONTH,
    global: { totalCap: null, byCategory: {} },
    byWallet: {},
    flags: { includeBills: true, cooldownHours: 12, thresholds: [0.5, 0.8, 1.0, 1.1], ...flags },
  };
}

export async function getBudgets() {
  const data = (await getData(KEY)) || null;
  if (!data) {
    const fresh = defaultBudgets();
    await saveData(KEY, fresh);
    return fresh;
  }
  if (data.monthKey !== THIS_MONTH) {
    const fresh = defaultBudgets(data.flags || {});
    await saveData(KEY, fresh);
    return fresh;
  }
  return data;
}

export async function saveBudgets(next) {
  const safe = { ...next, monthKey: THIS_MONTH };
  await saveData(KEY, safe);
  return safe;
}

// --- overspend computation (new) ---
export async function computeOverspendStates() {
  const b = await getBudgets();
  const wallets = (await getData('wallets')) || [];
  const res = [];

  for (const w of wallets) {
    const cap = b.byWallet?.[w.id]?.walletCap ?? null;
    if (cap && Number(w.balance) < 0) {
      res.push({ walletId: w.id, name: w.name, overspent: true, overBy: Math.abs(Number(w.balance)) });
    } else if (cap && Number(w.balance) > cap) {
      // optional: treat > cap as overspend, adjust as needed
      res.push({ walletId: w.id, name: w.name, overspent: true, overBy: Number(w.balance) - cap });
    } else {
      res.push({ walletId: w.id, name: w.name, overspent: false, overBy: 0 });
    }
  }
  return res;
}
