// src/utils/payables.js
import { getData, saveData } from './storage';
import { addQuickExpense } from './quickExpense';
import { normalizeWalletTiles, canonicalizeCategory } from './categoryTilesGuard';
import { schedulePayableNotifications, cancelPayableNotifications } from './notifications';
import { checkAndNotifyAfterExpense } from './budgetAlerts';

const KEY = 'payables_v1';

function nowISO() { return new Date().toISOString(); }
function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

// --- helpers ---------------------------------------------------------------

const PayableStatus = {
  UPCOMING: 'upcoming',
  DUE: 'due',
  OVERDUE: 'overdue',
  PAID: 'paid',
};
export { PayableStatus };

export async function listPayables() {
  return (await getData(KEY)) || [];
}

export async function savePayables(list) {
  await saveData(KEY, list);
  return list;
}

export function computeStatus(nextDueISO) {
  if (!nextDueISO) return PayableStatus.PAID;
  const today = new Date();
  const due = new Date(nextDueISO);
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dd = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  if (dd === d0) return PayableStatus.DUE;
  if (dd < d0) return PayableStatus.OVERDUE;
  return PayableStatus.UPCOMING;
}

function addMonths(dateISO, n) {
  const d = new Date(dateISO);
  const orig = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < orig) d.setDate(0);
  return d.toISOString();
}
function addDays(dateISO, n) {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function notifShape(p) {
  // notifications helper expects { id, title, dueDate, paid }
  return { id: p.id, title: p.name, dueDate: p.nextDueDate, paid: false };
}

async function safeSchedule(p) {
  try { await schedulePayableNotifications(notifShape(p)); } catch (e) {/* no-op */}
}
async function safeCancel(id) {
  try { await cancelPayableNotifications(id); } catch (e) {/* no-op */}
}
async function safeBudgetNotify() {
  try { await checkAndNotifyAfterExpense(); } catch (e) {/* no-op */}
}

// --- create/update ---------------------------------------------------------

/** Create a one-time Bill */
export async function createBill({
  name, amountType = 'fixed', amount = 0,
  category = 'Others', defaultSource = 'wallet', walletId = null,
  nextDueDate, notes = ''
}) {
  const all = await listPayables();
  const p = {
    id: makeId(),
    type: 'bill',
    name, notes,
    amountType, amount: Number(amount || 0),
    category,
    defaultSource, walletId,
    cadence: null, autopay: false, pausedUntil: null, trialEndDate: null,
    lastPaidDate: null,
    nextDueDate: nextDueDate || nowISO(),
    remindDaysBefore: 1,
    history: [],
  };
  all.push(p);
  await savePayables(all);

  // Do not let notifications block UI
  await safeSchedule(p);

  return p;
}

/** Create a Subscription (repeating) */
export async function createSubscription({
  name, amountType = 'fixed', amount = 0,
  category = 'Others', defaultSource = 'wallet', walletId = null,
  cadence = { unit: 'month', every: 1 }, autopay = true,
  nextDueDate, notes = '', trialEndDate = null
}) {
  const all = await listPayables();
  const p = {
    id: makeId(),
    type: 'subscription',
    name, notes,
    amountType, amount: Number(amount || 0),
    category,
    defaultSource, walletId,
    cadence, autopay, pausedUntil: null, trialEndDate,
    lastPaidDate: null,
    nextDueDate: nextDueDate || nowISO(),
    remindDaysBefore: 1,
    history: [],
  };
  all.push(p);
  await savePayables(all);

  await safeSchedule(p);

  return p;
}

export async function updatePayable(patch) {
  const all = await listPayables();
  const idx = all.findIndex(x => x.id === patch.id);
  if (idx === -1) return null;
  const before = all[idx];
  const merged = { ...before, ...patch };
  all[idx] = merged;
  await savePayables(all);

  // reschedule notifications when date changes
  if (patch.nextDueDate && patch.nextDueDate !== before.nextDueDate) {
    await safeCancel(merged.id);
    await safeSchedule(merged);
  }
  return merged;
}

// --- cadence & payment ------------------------------------------------------

/** Compute next due for subscriptions */
function nextFromCadence(currentISO, cadence) {
  if (!cadence) return null;
  const { unit = 'month', every = 1 } = cadence;
  if (unit === 'month') return addMonths(currentISO, every || 1);
  if (unit === 'week')  return addDays(currentISO, 7 * (every || 1));
  if (unit === 'day')   return addDays(currentISO, every || 1);
  if (unit === 'year')  return addMonths(currentISO, 12 * (every || 1));
  return addMonths(currentISO, every || 1);
}

/** Pay a bill/subscription and post a transaction */
export async function payNow(
  payableId,
  { amountOverride = null, sourceOverride = null, walletOverride = null } = {}
) {
  const all = await listPayables();
  const idx = all.findIndex(p => p.id === payableId);
  if (idx === -1) return { ok: false, reason: 'not_found' };
  const p = all[idx];

  const wallets = (await getData('wallets')) || [];
  const wallet = wallets.find(w => w.id === (walletOverride || p.walletId)) || null;

  const tiles = normalizeWalletTiles(wallet?.tiles || []);
  const category = canonicalizeCategory(p.category || 'Others', tiles);

  const amount = Number(amountOverride ?? p.amount ?? 0);

  const source = (sourceOverride || p.defaultSource || 'wallet');
  const res = await addQuickExpense({
    source,                                         // 'wallet' | 'total'
    walletId: source === 'wallet' ? wallet?.id : null,
    amount,
    description: p.name,
    category,
  });
  if (!res.ok) return res;

  // record payment history & compute next due
  const paidAt = nowISO();
  const entry = { date: paidAt, amount, category, source };
  const updated = { ...p, lastPaidDate: paidAt, history: [...(p.history || []), entry] };

  await safeCancel(p.id);

  if (p.type === 'subscription' && p.cadence) {
    updated.nextDueDate = nextFromCadence(p.nextDueDate || paidAt, p.cadence);
    await safeSchedule(updated);
  } else {
    updated.nextDueDate = null; // one-time bill done
  }

  all[idx] = updated;
  await savePayables(all);

  // keep budgets/alerts in sync but never block
  await safeBudgetNotify();

  return { ok: true, payable: updated };
}

/** Run autopay tick (call on app open / daily) */
export async function runAutopayTick() {
  const all = await listPayables();
  let changed = false;
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (p.type !== 'subscription' || !p.autopay) continue;
    if (p.pausedUntil && new Date(p.pausedUntil) > new Date()) continue;
    if (!p.nextDueDate) continue;

    const status = computeStatus(p.nextDueDate);
    if (status === PayableStatus.DUE || status === PayableStatus.OVERDUE) {
      const res = await payNow(p.id).catch(() => ({ ok: false }));
      if (res.ok) { changed = true; all[i] = res.payable; }
    }
  }
  if (changed) await savePayables(all);
  return { ok: true };
}
