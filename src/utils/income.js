// src/utils/income.js
import { getData, saveData } from './storage';
import { adjustTotalBalance, logToLedger } from './ledger';
import { fireBudgetNotification } from './notifications';

const KEY = 'recurring_incomes';

/**
 * Structure:
 * [{ id, type: 'salary'|'allowance', amount, dayOfMonth: 1-31, lastApplied: 'YYYY-MM-DD', enabled }]
 */

export async function getRecurringIncomeList() {
  const arr = (await getData(KEY)) || [];
  return Array.isArray(arr) ? arr : [];
}

/** Set or clear recurring incomes. Pass {enabled, amount, type, days: [d1, d2?]} */
export async function setRecurringIncomes(cfg) {
  if (!cfg?.enabled || !cfg?.days?.length || !cfg.amount) {
    await saveData(KEY, []);
    return;
  }
  const prev = await getRecurringIncomeList();
  const prevByDay = {};
  prev.forEach((p) => (prevByDay[p.dayOfMonth] = p));

  const list = cfg.days.map((d) => ({
    id: prevByDay[d]?.id || `inc-${d}-${Date.now()}`,
    type: cfg.type || prevByDay[d]?.type || 'salary',
    amount: Number(cfg.amount || 0),
    dayOfMonth: Number(d),
    lastApplied: prevByDay[d]?.lastApplied || null,
    enabled: true,
  }));

  await saveData(KEY, list);
}

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/**
 * Apply income ONLY if today == scheduled day (clamped to month length).
 * Fires a single OS notification only when the income is actually applied.
 */
export async function applyDueIncomes() {
  const list = await getRecurringIncomeList();
  if (!list.length) return;

  const now = new Date();
  const today = now.getDate();
  const todayYMD = ymd(now);
  const monthLength = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  let appliedAny = false;

  for (const inc of list) {
    if (!inc.enabled || !inc.amount) continue;
    const triggerDay = Math.min(inc.dayOfMonth || 1, monthLength);

    if (today === triggerDay && inc.lastApplied !== todayYMD) {
      await adjustTotalBalance(+inc.amount);
      await logToLedger({
        type: 'RECURRING_INCOME',
        source: inc.type?.toUpperCase() || 'INCOME',
        amount: inc.amount,
        date: new Date().toISOString(),
        note: `Auto-added on payday ${todayYMD}`,
      });
      inc.lastApplied = todayYMD;
      appliedAny = true;
    }
  }

  await saveData(KEY, list);

  if (appliedAny) {
    try {
      await fireBudgetNotification({
        title: 'Payday',
        body: 'Funds were added to your Total Balance.',
      });
    } catch {}
  }
}
