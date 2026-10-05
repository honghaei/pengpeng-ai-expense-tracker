// src/utils/financialContext.js
// Comprehensive context builder for Pengpeng AI.
//
// Goal:
// - The AI is NOT limited to hard-coded questions.
// - Every AI request receives the latest saved financial state.
// - Raw transactions + user-stated preferences + inferred spending patterns
//   are provided together so answers can be personalized.
//
// This is contextual personalization / RAG, not permanent model training.

import { getData, saveData } from './storage';
import { getTotalBalance } from './ledger';
import { getBudgets } from './budgets';
import { listPayables } from './payables';
import { getGoals } from './goals';
import { getRecurringIncomeList } from './income';
import { loadAutoSplit } from './autoSplit';
import { getEventHistory, getBalanceHistory } from './history';
import {
  ensureRagKB,
  rebuildKBFromStorage,
  computeAggregates,
  buildContextBlocks,
} from './rag';

const CHAT_KEY = 'financial_ai_chat_v2';
const MAX_CHAT_ITEMS = 24;

const arr = (value) => (Array.isArray(value) ? value : []);
const obj = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const lower = (value) => String(value || '').trim().toLowerCase();

const dateMs = (value) => {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const sortNewest = (rows = []) =>
  [...rows].sort((a, b) => dateMs(b?.date) - dateMs(a?.date));

const money = (value) =>
  `₱${num(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const isInternalMovement = (description = '', type = '') => {
  const d = lower(description);
  const t = lower(type);

  return (
    d.includes('wallet transfer') ||
    d.includes('transfer from') ||
    d.includes('transfer to') ||
    d.includes('deposit') ||
    d.includes('withdraw') ||
    d.includes('top up') ||
    d.includes('cash in') ||
    t.includes('wallet_transfer') ||
    t.includes('transfer')
  );
};

const isIncomeLike = (description = '', type = '') => {
  const d = lower(description);
  const t = lower(type);

  return (
    t.includes('income') ||
    d.includes('salary') ||
    d.includes('allowance') ||
    d.includes('income') ||
    d.includes('refund') ||
    d.includes('cashback') ||
    d.includes('rebate')
  );
};

const normalizeWallets = (wallets = []) =>
  arr(wallets).map((wallet) => ({
    id: wallet?.id || null,
    name: wallet?.name || 'Wallet',
    balance: num(wallet?.balance),
    monthlyCap:
      num(wallet?.monthlyCap) > 0 ? num(wallet.monthlyCap) : null,
    locked: !!wallet?.locked,
    expenses: sortNewest(arr(wallet?.expenses)).map((row) => ({
      id: row?.id || null,
      date: row?.date || null,
      amount: num(row?.amount),
      description: row?.description || '',
      category: row?.category || wallet?.name || 'Expense',
      source: row?.source || 'Wallet',
      walletId: wallet?.id || null,
      walletName: wallet?.name || 'Wallet',
      goalId: row?.goalId || row?.meta?.goalId || null,
      goalOp: row?.goalOp || row?.meta?.goalOp || null,
    })),
  }));

const normalizePayables = (payables = []) =>
  arr(payables).map((p) => ({
    id: p?.id || null,
    type: p?.type || (p?.subscription || p?.isSubscription ? 'subscription' : 'bill'),
    name: p?.name || p?.title || 'Payment',
    amount: num(p?.amount),
    amountType: p?.amountType || 'fixed',
    category: p?.category || 'Bills',
    defaultSource: p?.defaultSource || 'wallet',
    walletId: p?.walletId || null,
    nextDueDate: p?.nextDueDate || p?.dueDate || p?.nextDue || null,
    lastPaidDate: p?.lastPaidDate || p?.paidAt || null,
    cadence: p?.cadence || null,
    autopay: !!p?.autopay,
    paused: !!p?.paused,
    pausedUntil: p?.pausedUntil || null,
    hidden: !!p?.hidden,
    history: sortNewest(arr(p?.history)).map((h) => ({
      date: h?.date || p?.lastPaidDate || null,
      amount: num(h?.amount ?? p?.amount),
      category: h?.category || p?.category || 'Bills',
      source: h?.source || p?.defaultSource || 'wallet',
    })),
  }));

const normalizeGoals = (goals = []) =>
  arr(goals).map((g) => ({
    id: g?.id || null,
    name: g?.name || 'Savings Goal',
    target: num(g?.target),
    saved: num(g?.saved),
    months: num(g?.months),
    deductFrom: g?.deductFrom || 'total',
    createdAt: g?.createdAt || null,
    finishedAt: g?.finishedAt || null,
    finished: !!g?.finished,
    schedule: arr(g?.schedule).map((row) => ({
      date: row?.date || null,
      amount: num(row?.amount || row?.amountPlanned),
      confirmed: !!row?.confirmed,
    })),
  }));

const makeWalletTransactions = (wallets) => {
  const rows = [];

  wallets.forEach((wallet) => {
    arr(wallet.expenses).forEach((tx) => {
      const movement = isInternalMovement(tx.description);
      const income = isIncomeLike(tx.description);

      rows.push({
        id: tx.id || null,
        date: tx.date || null,
        kind: movement ? 'internal_transfer' : income ? 'income' : 'expense',
        amount: num(tx.amount),
        absoluteAmount: Math.abs(num(tx.amount)),
        description: tx.description || '',
        category: tx.category || wallet.name,
        walletId: wallet.id,
        walletName: wallet.name,
        sourceDataset: 'wallet_expenses',
        goalId: tx.goalId || null,
        goalOp: tx.goalOp || null,
      });
    });
  });

  return rows;
};

const makeLedgerTransactions = (ledger) =>
  arr(ledger).map((row, index) => {
    const type = String(row?.type || '').toUpperCase();
    const description = row?.note || row?.description || type;
    const internal = isInternalMovement(description, type);
    const income = isIncomeLike(description, type);

    let kind = 'ledger_event';

    if (income) kind = 'income';
    else if (
      type.includes('EXPENSE') ||
      type.includes('DEBIT') ||
      lower(description).includes('expense')
    ) {
      kind = 'expense';
    } else if (internal) {
      kind = 'internal_transfer';
    } else if (type.includes('GOAL')) {
      kind = 'goal';
    }

    return {
      id: row?.id || `ledger-${index}`,
      date: row?.date || null,
      kind,
      amount: num(row?.amount),
      absoluteAmount: Math.abs(num(row?.amount)),
      description,
      category: row?.category || type || 'Ledger',
      source: row?.source || null,
      fromWalletId: row?.fromWalletId || null,
      toWalletId: row?.toWalletId || null,
      sourceDataset: 'ledger',
    };
  });

const makePayableTransactions = (payables) => {
  const rows = [];

  payables.forEach((p) => {
    arr(p.history).forEach((h, index) => {
      rows.push({
        id: `${p.id || p.name}-history-${index}`,
        date: h.date || p.lastPaidDate || null,
        kind: p.type === 'subscription' ? 'subscription_payment' : 'bill_payment',
        amount: num(h.amount || p.amount),
        absoluteAmount: Math.abs(num(h.amount || p.amount)),
        description: p.name,
        category: p.category || 'Bills',
        source: h.source || p.defaultSource || null,
        walletId: p.walletId || null,
        sourceDataset: 'payable_history',
      });
    });
  });

  return rows;
};

const makeLegacyBillTransactions = (legacyBills) =>
  arr(legacyBills)
    .filter((b) => b?.paid)
    .map((b, index) => ({
      id: b?.id || `legacy-bill-${index}`,
      date: b?.paidAt || b?.dueDate || null,
      kind: 'bill_payment',
      amount: num(b?.amount),
      absoluteAmount: Math.abs(num(b?.amount)),
      description: b?.title || 'Bill',
      category: b?.category || 'Bills',
      source: 'legacy_bills',
      walletId: b?.walletId || null,
      sourceDataset: 'legacy_bills',
    }));

const uniqueTransactionKey = (row) =>
  [
    row.kind,
    row.date || '',
    Math.round(num(row.absoluteAmount) * 100) / 100,
    lower(row.description),
    row.walletId || '',
  ].join('|');

const deDuplicateTransactions = (rows) => {
  const seen = new Set();
  const output = [];

  sortNewest(rows).forEach((row) => {
    const key = uniqueTransactionKey(row);

    if (!seen.has(key)) {
      seen.add(key);
      output.push(row);
    }
  });

  return output;
};

const expenseRowsForPatterns = (transactions) =>
  arr(transactions).filter(
    (row) =>
      row.kind === 'expense' ||
      row.kind === 'bill_payment' ||
      row.kind === 'subscription_payment'
  );

const categoryStats = (expenses) => {
  const totals = {};

  expenses.forEach((row) => {
    const category = row.category || row.walletName || 'Other';
    totals[category] = (totals[category] || 0) + Math.abs(num(row.absoluteAmount));
  });

  return Object.entries(totals)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
};

const merchantStats = (expenses) => {
  const totals = {};

  expenses.forEach((row) => {
    const name = String(row.description || '').trim();
    if (!name) return;

    if (!totals[name]) {
      totals[name] = {
        name,
        count: 0,
        total: 0,
        lastDate: null,
      };
    }

    totals[name].count += 1;
    totals[name].total += Math.abs(num(row.absoluteAmount));

    if (dateMs(row.date) > dateMs(totals[name].lastDate)) {
      totals[name].lastDate = row.date;
    }
  });

  return Object.values(totals)
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.count - a.count || b.total - a.total);
};

const monthKey = (value) => {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const spendingPatternProfile = ({
  transactions,
  wallets,
  payables,
  profile,
  aggregates,
}) => {
  const expenses = expenseRowsForPatterns(transactions);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(
    lastMonthDate.getMonth() + 1
  ).padStart(2, '0')}`;

  const currentMonthExpenses = expenses.filter(
    (row) => monthKey(row.date) === currentMonth
  );

  const lastMonthExpenses = expenses.filter(
    (row) => monthKey(row.date) === lastMonth
  );

  const sum = (rows) =>
    rows.reduce((total, row) => total + Math.abs(num(row.absoluteAmount)), 0);

  const weekendRows = expenses.filter((row) => {
    const d = new Date(row.date);
    const day = d.getDay();
    return day === 0 || day === 6;
  });

  const weekdayRows = expenses.filter((row) => {
    const d = new Date(row.date);
    const day = d.getDay();
    return day >= 1 && day <= 5;
  });

  const walletRisks = arr(wallets)
    .filter((w) => num(w.monthlyCap) > 0)
    .map((w) => {
      const usedFromAggregate = arr(aggregates?.budgetWallets).find(
        (row) => row?.id === w.id
      );

      const used = num(usedFromAggregate?.used);
      const cap = num(w.monthlyCap);

      return {
        walletId: w.id,
        walletName: w.name,
        cap,
        used,
        percentUsed: cap > 0 ? Math.round((used / cap) * 100) : 0,
        remaining: cap > 0 ? cap - used : null,
      };
    })
    .sort((a, b) => b.percentUsed - a.percentUsed);

  const currentTotal = sum(currentMonthExpenses);
  const lastTotal = sum(lastMonthExpenses);

  return {
    transactionCount: expenses.length,
    currentMonthSpend: currentTotal,
    lastMonthSpend: lastTotal,
    monthOverMonthChangePct:
      lastTotal > 0 ? Math.round(((currentTotal - lastTotal) / lastTotal) * 100) : null,
    averageExpense:
      expenses.length > 0 ? sum(expenses) / expenses.length : 0,
    largestExpense:
      expenses.length > 0
        ? [...expenses].sort(
            (a, b) => Math.abs(num(b.absoluteAmount)) - Math.abs(num(a.absoluteAmount))
          )[0]
        : null,
    topCategoriesAllTime: categoryStats(expenses).slice(0, 10),
    topCategoriesThisMonth: categoryStats(currentMonthExpenses).slice(0, 10),
    repeatedMerchants: merchantStats(expenses).slice(0, 12),
    weekendSpend: sum(weekendRows),
    weekdaySpend: sum(weekdayRows),
    weekendSharePct:
      sum(expenses) > 0 ? Math.round((sum(weekendRows) / sum(expenses)) * 100) : 0,
    walletBudgetRisk: walletRisks,
    statedPreferences: {
      commonSpendingCategories: arr(profile?.habits?.top3),
      budgetBehavior: profile?.habits?.exceedBudget || null,
      spendingDriver: profile?.habits?.spendDriver || null,
      lowBalanceAlertPct: num(profile?.alerts?.lowBalancePct) || null,
      incomeType: profile?.incomeType || null,
      monthlyIncome: num(profile?.monthlyIncome),
      paydayDays: arr(profile?.autoIncome?.days),
    },
    paymentBehavior: {
      billsCount: payables.filter((p) => p.type === 'bill').length,
      subscriptionsCount: payables.filter((p) => p.type === 'subscription').length,
      autopaySubscriptions: payables.filter(
        (p) => p.type === 'subscription' && p.autopay
      ).length,
    },
  };
};

const upcomingPayments = (payables = []) =>
  arr(payables)
    .filter((p) => p?.nextDueDate && !p?.hidden)
    .sort((a, b) => dateMs(a.nextDueDate) - dateMs(b.nextDueDate))
    .map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      amount: p.amount,
      dueDate: p.nextDueDate,
      source: p.defaultSource,
      walletId: p.walletId,
      autopay: p.autopay,
      paused: p.paused,
    }));

const autoSplitNamed = (autoSplit, wallets) => {
  const walletNames = Object.fromEntries(
    arr(wallets).map((wallet) => [wallet.id, wallet.name])
  );

  return Object.entries(obj(autoSplit?.allocationsPct))
    .map(([walletId, percent]) => ({
      walletId,
      walletName: walletNames[walletId] || walletId,
      percent: num(percent),
    }))
    .filter((row) => row.percent > 0);
};

export async function getFinancialAIChatHistory() {
  return arr(await getData(CHAT_KEY)).slice(-MAX_CHAT_ITEMS);
}

export async function rememberFinancialAIExchange(question, answer) {
  const current = await getFinancialAIChatHistory();

  const next = [
    ...current,
    {
      date: new Date().toISOString(),
      question: String(question || '').trim(),
      answer: String(answer || '').trim(),
    },
  ].slice(-MAX_CHAT_ITEMS);

  await saveData(CHAT_KEY, next);
  return next;
}

export async function buildFinancialAIContext({ question = '' } = {}) {
  try {
    await ensureRagKB();
    await rebuildKBFromStorage();
  } catch {}

  const [
    profileRaw,
    walletsRaw,
    payablesRaw,
    goalsRaw,
    budgetsRaw,
    recurringIncomeRaw,
    autoSplitRaw,
    ledgerRaw,
    merchantMemoryRaw,
    eventHistoryRaw,
    balanceHistoryRaw,
    chatHistoryRaw,
    totalBalanceRaw,
    aggregatesRaw,
    legacyBillsRaw,
    legacyHistoryRaw,
    hiddenIdsRaw,
  ] = await Promise.all([
    getData('user_profile'),
    getData('wallets'),
    listPayables().catch(async () => arr(await getData('payables_v1'))),
    getGoals().catch(async () => arr(await getData('goals'))),
    getBudgets().catch(async () => obj(await getData('budgets_v1'))),
    getRecurringIncomeList().catch(async () => arr(await getData('recurring_incomes'))),
    loadAutoSplit().catch(async () => obj(await getData('wallet_auto_split'))),
    getData('ledger'),
    getData('merchant_memory_v1'),
    getEventHistory().catch(() => []),
    getBalanceHistory().catch(() => []),
    getFinancialAIChatHistory(),
    getTotalBalance().catch(async () => num(await getData('total_balance'))),
    computeAggregates().catch(() => ({})),
    getData('bills'),
    getData('history'),
    getData('hidden_tx_ids'),
  ]);

  const profile = obj(profileRaw);
  const wallets = normalizeWallets(walletsRaw);
  const payables = normalizePayables(payablesRaw);
  const goals = normalizeGoals(goalsRaw);
  const budgets = obj(budgetsRaw);
  const recurringIncome = arr(recurringIncomeRaw);
  const ledger = sortNewest(arr(ledgerRaw));
  const eventHistory = sortNewest(arr(eventHistoryRaw));
  const balanceHistory = arr(balanceHistoryRaw);
  const aggregates = obj(aggregatesRaw);
  const legacyBills = arr(legacyBillsRaw);
  const legacyHistory = sortNewest(arr(legacyHistoryRaw));
  const hiddenTransactionIds = arr(hiddenIdsRaw);

  const allTransactions = deDuplicateTransactions([
    ...makeWalletTransactions(wallets),
    ...makeLedgerTransactions(ledger),
    ...makePayableTransactions(payables),
    ...makeLegacyBillTransactions(legacyBills),
    ...eventHistory.map((row, index) => ({
      id: row?.id || `event-${index}`,
      date: row?.date || null,
      kind: row?.type || 'event',
      amount: num(row?.amount),
      absoluteAmount: Math.abs(num(row?.amount)),
      description: row?.description || row?.note || row?.type || 'Event',
      category: row?.category || 'History',
      walletId: row?.walletId || null,
      sourceDataset: 'event_history',
    })),
    ...legacyHistory.map((row, index) => ({
      id: row?.id || `history-${index}`,
      date: row?.date || row?.createdAt || null,
      kind: row?.kind || row?.type || 'history',
      amount: num(row?.amount),
      absoluteAmount: Math.abs(num(row?.amount)),
      description: row?.title || row?.description || row?.category || 'History',
      category: row?.category || 'History',
      walletId: row?.walletId || null,
      walletName: row?.walletName || null,
      sourceDataset: 'legacy_history',
    })),
  ]);

  const totalBalance = num(totalBalanceRaw);
  const totalWalletBalance = wallets.reduce(
    (sum, wallet) => sum + num(wallet.balance),
    0
  );

  let retrieval = {
    summaryBlock: '',
    matchesBlock: '',
  };

  try {
    const blocks = await buildContextBlocks({
      q: String(question || ''),
      k: 16,
    });

    retrieval = {
      summaryBlock: blocks?.summaryBlock || '',
      matchesBlock: blocks?.matchesBlock || '',
    };
  } catch {}

  const patterns = spendingPatternProfile({
    transactions: allTransactions,
    wallets,
    payables,
    profile,
    aggregates,
  });

  const data = {
    generatedAt: new Date().toISOString(),

    appIdentity: {
      appName: 'Pengpeng',
      featureName: 'Pengpeng AI',
      userName: profile?.name || '',
      rule:
        'The profile name belongs to the user. Never call the app or the AI by the user name.',
    },

    userProfile: {
      name: profile?.name || '',
      age: profile?.age ?? null,
      incomeType: profile?.incomeType || '',
      monthlyIncome: num(profile?.monthlyIncome),
      habits: obj(profile?.habits),
      alerts: obj(profile?.alerts),
      autoIncome: obj(profile?.autoIncome),
      otherPreferences: obj(profile?.aiExtras),
    },

    balances: {
      totalBalance,
      totalWalletBalance,
      totalFunds: totalBalance + totalWalletBalance,
    },

    analytics: aggregates,
    spendingPatterns: patterns,
    budgets,
    wallets,
    payables,
    upcomingPayments: upcomingPayments(payables),
    legacyBills,
    savingsGoals: goals,
    recurringIncome,
    autoSplit: {
      allocations: autoSplitNamed(autoSplitRaw, wallets),
      lastApplied: obj(autoSplitRaw?.lastApplied),
    },

    // All transaction/event records currently stored by the app.
    allTransactions,

    ledger,
    eventHistory,
    legacyHistory,
    balanceHistory,
    hiddenTransactionIds,
    merchantMemory: obj(merchantMemoryRaw),

    recentFinancialAIConversation: arr(chatHistoryRaw),
    retrieval,
  };

  const prompt = [
    'You are Pengpeng, the AI assistant inside the Pengpeng expense tracker.',
    '',
    'CORE IDENTITY RULES',
    '- Pengpeng is the app brand.',
    '- The AI assistant is called Pengpeng.',
    '- The profile name is the USER name. Never use the user name as your own name.',
    '',
    'CAPABILITY',
    '- You are NOT limited to canned questions or a fixed list of intents.',
    '- Answer any reasonable user question.',
    '- For personal-finance questions, reason from the supplied app data.',
    '- For general financial education, answer normally and clearly label what is general guidance versus what comes from this user data.',
    '- If the user asks a non-finance question, answer briefly unless it conflicts with the role of the app.',
    '',
    'PERSONALIZATION',
    '- Personalize advice using BOTH explicit user preferences and inferred spending patterns.',
    '- Explicit preferences include stated spending categories, budget behavior, spending driver, monthly income, payday schedule, alert threshold, goals, and Auto Split settings.',
    '- Inferred patterns include top categories, repeated merchants, weekday/weekend behavior, average expense size, month-over-month changes, budget-cap risk, bill/subscription behavior, and transaction history.',
    '- When an observation is inferred rather than explicitly stated, say things like "Based on your recorded spending..." rather than presenting it as a permanent trait.',
    '- Do not shame the user. Give practical next actions.',
    '',
    'DATA RULES',
    '- Treat the supplied CURRENT APP DATA as the factual source of truth for this user.',
    '- You have access to the complete transaction/event data currently stored by the app in allTransactions, plus balances, wallets, budgets, bills, subscriptions, income, payday settings, Auto Split, goals, ledger, history, and conversation context.',
    '- Do calculations when needed.',
    '- Do not invent transactions, merchants, balances, bills, due dates, goals, income, preferences, or trends.',
    '- If records conflict, mention the conflict rather than silently choosing a value.',
    '- If the data is insufficient, say exactly what is missing.',
    '- Do not claim that you permanently trained on or permanently learned the user. The app supplies current context each time.',
    '',
    'RESPONSE STYLE',
    '- Be concise but useful.',
    '- Lead with the direct answer.',
    '- Include the most relevant numbers when the question is about the user data.',
    '- When giving a recommendation, explain which recorded pattern or upcoming obligation supports it.',
    '- Avoid markdown tables.',
    '',
    '=== CURRENT APP DATA ===',
    JSON.stringify(data),
    '',
    '=== USER QUESTION ===',
    String(question || '').trim(),
  ].join('\n');

  return { data, prompt };
}

export function buildLocalFinancialAnswer(question, context) {
  const q = lower(question);
  const ctx = context || {};
  const analytics = obj(ctx.analytics);
  const patterns = obj(ctx.spendingPatterns);

  if (!q) return 'Ask a question about your finances.';

  if (
    q.includes('total funds') ||
    q.includes('how much money') ||
    q.includes('all my money')
  ) {
    return `Your current total funds are ${money(
      ctx?.balances?.totalFunds
    )}: ${money(ctx?.balances?.totalBalance)} in Total Balance and ${money(
      ctx?.balances?.totalWalletBalance
    )} across wallets.`;
  }

  if (
    q.includes('this month') &&
    (q.includes('spent') || q.includes('spend') || q.includes('expense'))
  ) {
    return `Your recorded spending this month is ${money(
      analytics?.thisMonthSpend || patterns?.currentMonthSpend || 0
    )}.`;
  }

  if (
    q.includes('bill') ||
    q.includes('subscription') ||
    q.includes('due')
  ) {
    const rows = arr(ctx.upcomingPayments).slice(0, 8);

    if (!rows.length) {
      return 'You currently have no upcoming bills or subscriptions saved.';
    }

    return rows
      .map((row) => {
        const due = row.dueDate
          ? new Date(row.dueDate).toLocaleDateString()
          : 'no due date';

        return `${row.name}: ${money(row.amount)} due ${due}${
          row.autopay ? ' (Autopay on)' : ''
        }`;
      })
      .join(' · ');
  }

  if (q.includes('goal') || q.includes('saving')) {
    const goals = arr(ctx.savingsGoals);

    if (!goals.length) {
      return 'You do not have a savings goal saved yet.';
    }

    return goals
      .map((goal) => {
        const target = num(goal.target);
        const saved = num(goal.saved);
        const pct = target > 0 ? Math.round((saved / target) * 100) : 0;

        return `${goal.name}: ${money(saved)} of ${money(target)} saved (${pct}%).`;
      })
      .join(' ');
  }

  if (q.includes('auto split') || q.includes('autosplit')) {
    const allocations = arr(ctx?.autoSplit?.allocations);

    if (!allocations.length) {
      return 'Auto Split does not have any allocation percentages configured yet.';
    }

    return `Your Auto Split is ${allocations
      .map((row) => `${row.walletName} ${row.percent}%`)
      .join(', ')}.`;
  }

  if (
    q.includes('pattern') ||
    q.includes('habit') ||
    q.includes('improve') ||
    q.includes('advice') ||
    q.includes('recommend')
  ) {
    const top = arr(patterns?.topCategoriesThisMonth)[0];
    const risk = arr(patterns?.walletBudgetRisk)[0];

    return [
      top
        ? `Your highest recorded spending category this month is ${top.name} at ${money(
            top.total
          )}.`
        : '',
      risk?.cap
        ? `${risk.walletName} is at ${risk.percentUsed}% of its monthly cap.`
        : '',
      patterns?.monthOverMonthChangePct != null
        ? `Your recorded spending is ${Math.abs(patterns.monthOverMonthChangePct)}% ${
            patterns.monthOverMonthChangePct >= 0 ? 'higher' : 'lower'
          } than last month so far.`
        : '',
      'Connect the optional secure Pengpeng AI backend for open-ended personalized coaching across all of your saved data.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return (
    'I can read your saved balances, wallets, transactions, budgets, bills, subscriptions, income, Auto Split, goals, and spending patterns. ' +
    'This device is currently using local insights, so open-ended generative questions require the optional secure Pengpeng AI backend to be connected.'
  );
}
