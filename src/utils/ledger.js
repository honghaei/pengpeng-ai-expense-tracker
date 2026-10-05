import { getData, saveData } from './storage';
import { appendHistory } from './history';

// ---------- helpers ----------
const nowISO = () => new Date().toISOString();
const rid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const parseMoney = (v) =>
  Number(parseFloat(String(v ?? '').replace(/[^\d.]/g, '')) || 0);

// All ledger records are stored under 'ledger' as an array of entries
async function addLedger(type, payload = {}) {
  const ledger = (await getData('ledger')) || [];
  const entry = { id: rid(), type, date: nowISO(), ...payload };
  await saveData('ledger', [...ledger, entry]);
  return entry;
}

// (public helper used elsewhere, e.g. income.js)
export async function logToLedger(entry = {}) {
  const { type = 'MISC', ...rest } = entry;
  return addLedger(type, rest);
}

// ---------- TOTAL BALANCE POOL ----------
export async function getTotalBalance() {
  return Number((await getData('total_balance')) || 0);
}

export async function setTotalBalance(v) {
  await saveData('total_balance', Number(v || 0));
}

/** Adjusts the total balance and logs both ledger + history */
export async function adjustTotalBalance(delta) {
  const d = Number(delta || 0);
  const cur = Number((await getData('total_balance')) || 0);
  const next = cur + d;
  if (next < 0) return { ok: false, reason: 'insufficient_total' };

  await setTotalBalance(next);
  await addLedger('ADJUST_TOTAL', { delta: d });
  await appendHistory({
    type: 'adjust_total',
    amount: d,
    date: nowISO(),
  });
  return { ok: true, total: next };
}

/** Atomically deduct from Total and record a TOTAL_EXPENSE (for Quick Add) */
export async function spendFromTotal(amount, category = 'Expense', description = '') {
  const amt = parseMoney(amount);
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };

  const total = await getTotalBalance();
  if (total < amt) return { ok: false, reason: 'insufficient_total', total };

  // deduct first
  await setTotalBalance(total - amt);

  // log to ledger
  const entry = await addLedger('TOTAL_EXPENSE', {
    amount: amt,
    category,
    description,
  });

  // history for the “Recent” stream
  await appendHistory({
    type: 'total_expense',
    amount: amt,
    category,
    description,
    date: entry.date,
  });

  return { ok: true, entry };
}

// ---------- TRANSFERS ----------
export async function transferFromTotalToWallet(walletId, amount) {
  const amt = parseMoney(amount);
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };

  const total = await getTotalBalance();
  if (total < amt) return { ok: false, reason: 'insufficient_total' };

  const wallets = (await getData('wallets')) || [];
  const idx = wallets.findIndex((w) => w.id === walletId);
  if (idx === -1) return { ok: false, reason: 'wallet_not_found' };

  // move balances
  wallets[idx].balance = Number(wallets[idx].balance || 0) + amt;
  await setTotalBalance(total - amt);

  // ✅ wallet-side row: POSITIVE (credit)
  const ts = nowISO();
  const depositEntry = {
    id: rid(),
    date: ts,
    category: 'Wallet deposit',
    description: 'Deposit from Total Balance',
    amount: +amt,
  };
  wallets[idx].expenses = [...(wallets[idx].expenses || []), depositEntry];

  await saveData('wallets', wallets);
  await addLedger('TOTAL_TO_WALLET', { walletId, amount: amt });

  await appendHistory({
    type: 'transfer',
    direction: 'cash_to_wallet',
    walletId,
    amount: amt,
    date: ts,
  });

  return { ok: true };
}

export async function transferFromWalletToTotal(walletId, amount) {
  const amt = parseMoney(amount);
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };

  const wallets = (await getData('wallets')) || [];
  const idx = wallets.findIndex((w) => w.id === walletId);
  if (idx === -1) return { ok: false, reason: 'wallet_not_found' };

  const cur = Number(wallets[idx].balance || 0);
  if (cur < amt) return { ok: false, reason: 'insufficient_wallet' };

  // move balances
  wallets[idx].balance = cur - amt;
  const total = await getTotalBalance();
  await setTotalBalance(total + amt);

  // ✅ wallet-side row: NEGATIVE (debit)
  const ts = nowISO();
  const withdrawEntry = {
    id: rid(),
    date: ts,
    category: 'Wallet withdraw',
    description: 'Withdraw to Total Balance',
    amount: -amt,
  };
  wallets[idx].expenses = [...(wallets[idx].expenses || []), withdrawEntry];

  await saveData('wallets', wallets);
  await addLedger('WALLET_TO_TOTAL', { walletId, amount: amt });

  await appendHistory({
    type: 'transfer',
    direction: 'wallet_to_cash',
    walletId,
    amount: amt,
    date: ts,
  });

  return { ok: true };
}

export async function transferBetweenWallets(fromId, toId, amount) {
  const amt = parseMoney(amount);
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };
  if (fromId === toId) return { ok: false, reason: 'same_wallet' };

  const wallets = (await getData('wallets')) || [];
  const aIdx = wallets.findIndex((w) => w.id === fromId);
  const bIdx = wallets.findIndex((w) => w.id === toId);
  if (aIdx === -1 || bIdx === -1) return { ok: false, reason: 'wallet_not_found' };

  const a = wallets[aIdx];
  const b = wallets[bIdx];

  if (Number(a.balance || 0) < amt) return { ok: false, reason: 'insufficient_wallet' };

  // move balances
  a.balance = Number(a.balance || 0) - amt;
  b.balance = Number(b.balance || 0) + amt;

  // ✅ dual wallet-side rows
  const ts = nowISO();
  const fromRow = {
    id: rid(),
    date: ts,
    category: 'Wallet transfer',
    description: `Wallet transfer → ${b.name}`,
    amount: -amt, // debit
  };
  const toRow = {
    id: rid(),
    date: ts,
    category: 'Wallet transfer',
    description: `Wallet transfer ← ${a.name}`,
    amount: +amt, // credit
  };
  a.expenses = [...(a.expenses || []), fromRow];
  b.expenses = [...(b.expenses || []), toRow];

  await saveData('wallets', wallets);
  await addLedger('WALLET_TO_WALLET', { fromId, toId, amount: amt });

  await appendHistory({
    type: 'transfer',
    direction: 'wallet_to_wallet',
    fromId,
    toId,
    amount: amt,
    date: ts,
  });

  return { ok: true };
}

// ---------- WALLET EXPENSE (generic) ----------
export async function addWalletExpense(walletId, amount, category = 'Expense', extra = {}) {
  const amt = parseMoney(amount);
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };

  const wallets = (await getData('wallets')) || [];
  const idx = wallets.findIndex((w) => w.id === walletId);
  if (idx === -1) return { ok: false, reason: 'wallet_not_found' };

  const w = wallets[idx];
  if (Number(w.balance || 0) < amt) return { ok: false, reason: 'insufficient_wallet' };

  // ✅ store negative for expenses
  const expense = {
    id: rid(),
    date: nowISO(),
    category,
    description: extra?.description || 'Expense',
    amount: -amt,
    ...extra,
  };

  w.balance = Number(w.balance || 0) - amt;
  w.expenses = [...(w.expenses || []), expense];

  await saveData('wallets', wallets);
  await addLedger('WALLET_EXPENSE', { walletId, amount: amt, category, meta: extra });

  await appendHistory({
    type: 'expense',
    walletId,
    amount: amt, // history can keep absolute if you prefer; UI color is driven by wallet row sign
    category,
    date: expense.date,
  });

  return { ok: true, expenseId: expense.id };
}

export async function removeWalletExpense(walletId, expenseId) {
  const wallets = (await getData('wallets')) || [];
  const idx = wallets.findIndex((w) => w.id === walletId);
  if (idx === -1) return { ok: false, reason: 'wallet_not_found' };

  const w = wallets[idx];
  const exp = (w.expenses || []).find((e) => e.id === expenseId);
  if (!exp) return { ok: false, reason: 'expense_not_found' };

  // If stored as negative, refund should add back the absolute value
  const refund = Math.abs(Number(exp.amount || 0));

  w.balance = Number(w.balance || 0) + refund;
  w.expenses = (w.expenses || []).filter((e) => e.id !== expenseId);

  await saveData('wallets', wallets);
  await addLedger('WALLET_EXPENSE_REVERSE', { walletId, amount: refund, expenseId });

  await appendHistory({
    type: 'expense_refund',
    walletId,
    amount: refund,
    expenseId,
    date: nowISO(),
  });

  return { ok: true, amount: refund };
}
