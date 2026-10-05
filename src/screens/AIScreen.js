// src/screens/AIScreen.js
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getData, saveData } from '../utils/storage';

import {
  ensureRagKB,
  rebuildKBFromStorage,
  computeAggregates,
  buildContextBlocks,
  getYesterdaySnapshot,
} from '../utils/rag';

import { getBudgets, THIS_MONTH, monthKey } from '../utils/budgets';
import { listPayables } from '../utils/payables';
import { getTotalBalance } from '../utils/ledger';
import { requestFinancialAI, isRemoteAIConfigured } from '../services/aiClient';
import {
  buildFinancialAIContext,
  buildLocalFinancialAnswer as buildFullLocalAnswer,
  rememberFinancialAIExchange,
} from '../utils/financialContext';
import { palette, gradients, radius, spacing, text as type, shadow } from '../theme/design';
import PengpengAvatar from '../components/PengpengAvatar';

const pad = (n) => String(n).padStart(2, '0');
const toYMD = (d) => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const peso = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const withinLastNDays = (date, n) => {
  const t = new Date(date);
  if (Number.isNaN(t)) return false;
  return t >= startOfDay(daysAgo(n)) && t <= new Date();
};

// strip markdown **bold**, *italic*, __bold__, _italic_
const stripMd = (s) =>
  String(s || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1');

const ADVICE_KEY = 'ai_daily_advice';

/* ======================= GENERALIZED QUICK QUESTIONS ======================= */
const QUICK_QUESTIONS = [
  'How much have I spent this week?',
  'How much have I spent this month?',
  'Which wallet is closest to its cap?',
  'Any wallets over budget?',
  'Show my recent expenses per wallet.',
  'What are my top spending wallets this month?',
  'What bills or subscriptions are due soon?',
  'Based on last month, will my budget last until next payday?',
];
/* ========================================================================= */

/* Remote AI requests are routed through a server-side proxy. */

/* ---------- ADVANCED SNAPSHOT (merge bills/subs into wallet expense history) ---------- */
const buildAdvancedSnapshot = async () => {
  // Same value shown on Home → Remaining Cash (Total Balance)
  const remainingCashHome = Number((await getTotalBalance()) || 0);

  const wallets = (await getData('wallets')) || [];
  const bills = (await getData('bills')) || [];
  const payables = await listPayables().catch(() => []);
  const ledger = (await getData('ledger')) || [];
  const budgets = await getBudgets();

  const includeBillsInUsage = !!budgets?.flags?.includeBills;
  const capsByWallet = budgets?.byWallet || {};
  const walletsSummary = [];
  let thisMonthSpendAll = 0;

  // ===== helper: classify non-expense movements by description (keep consistent with WalletDetail UI) =====
  const isNonExpenseMovement = (desc = '') => {
    const s = String(desc).toLowerCase();
    return (
      s.includes('wallet transfer') ||
      s.includes('transfer from') ||
      s.includes('transfer to') ||
      s.includes('deposit') ||
      s.includes('withdraw')
    );
  };

  const groupBillsAndSubscriptions = (items = []) => {
  const bills = [];
  const subs = [];
  for (const it of items) {
    if (it.type === 'bill') bills.push(it);
    else if (it.type === 'subscription') subs.push(it);
  }
  return { bills, subs };
};

const splitPaidUnpaid = (items = []) => {
  const paid = [];
  const unpaid = [];
  for (const it of items) {
    if (it.status === 'paid') paid.push(it);
    else unpaid.push(it);
  }
  return { paid, unpaid };
};

  // ===== 1) Compute per-wallet caps/usage (existing behavior) =====
  for (const w of wallets) {
    const capNum = Number(capsByWallet?.[w.id]?.walletCap ?? w.monthlyCap ?? NaN);
    const cap = Number.isFinite(capNum) && capNum > 0 ? capNum : null;
    let usedThisMonth = 0;

    (w.expenses || []).forEach((e) => {
      if (!e?.date) return;
      const amt = Number(e.amount || 0);
      if (!isNonExpenseMovement(e.description) && amt < 0 && monthKey(e.date) === THIS_MONTH) {
        usedThisMonth += Math.abs(amt);
      }
    });

    if (includeBillsInUsage) {
      bills
        .filter(
          (bb) =>
            bb.paid &&
            bb.walletId === w.id &&
            (bb.paidAt || bb.dueDate) &&
            monthKey(bb.paidAt || bb.dueDate) === THIS_MONTH
        )
        .forEach((bb) => (usedThisMonth += Number(bb.amount || 0)));
    }

    thisMonthSpendAll += usedThisMonth;

    walletsSummary.push({
      id: w.id,
      name: w.name,
      balance: Number(w.balance || 0),
      cap,
      usedThisMonth,
      remainingCap: cap ? Math.max(0, cap - usedThisMonth) : null,
    });
  }

  // ===== 2) Weekly cross-feature expenses (for quick weekly Qs) =====
  const weeklyExpenses = [];
  wallets.forEach((w) => {
    (w.expenses || []).forEach((e) => {
      const amt = Number(e.amount || 0);
      if (amt < 0 && e?.date && withinLastNDays(e.date, 7)) {
        weeklyExpenses.push({
          source: 'Wallet',
          walletId: w.id,
          walletName: w.name,
          amount: Math.abs(amt),
          date: e.date,
          description: e.description || w.name,
        });
      }
    });
  });

  // Bills (paid) within last 7 days (will be merged as wallet expenses later too)
  bills
    .filter((b) => b.paid && (b.paidAt || b.dueDate) && withinLastNDays(b.paidAt || b.dueDate, 7))
    .forEach((b) => {
      const wn = wallets.find((ww) => ww.id === b.walletId)?.name || 'Wallet';
      weeklyExpenses.push({
        source: 'Bill',
        walletId: b.walletId || null,
        walletName: wn,
        amount: Number(b.amount || 0),
        date: b.paidAt || b.dueDate,
        description: b.title || 'Bill',
      });
    });

  // Subscriptions pay history within last 7 days
  (payables || []).forEach((p) => {
    (p.history || []).forEach((h) => {
      if (!h?.date || !withinLastNDays(h.date, 7)) return;
      const src = h.source || p.defaultSource || 'wallet';
      const wId = src === 'wallet' ? p.walletId || null : null;
      const wName = src === 'wallet'
        ? (wallets.find((ww) => ww.id === wId)?.name || 'Wallet')
        : 'Total Balance';
      weeklyExpenses.push({
        source: src === 'wallet' ? 'Subscription' : 'Total',
        walletId: wId,
        walletName: wName,
        amount: Number(h.amount ?? p.amount ?? 0),
        date: h.date,
        description: p.name || 'Subscription',
      });
    });
  });

  (ledger || [])
    .filter((r) => r.type === 'TOTAL_EXPENSE' && r?.date && withinLastNDays(r.date, 7))
    .forEach((r) => {
      weeklyExpenses.push({
        source: 'Total',
        walletId: null,
        walletName: 'Total Balance',
        amount: Number(r.amount || 0),
        date: r.date,
        description: r.description || r.category || 'Expense',
      });
    });

  // ===== 3) Per-wallet EXPENSE HISTORY (ALL-TIME) — MERGE bills & subs into wallet history =====
  // We construct a canonical, AI-friendly list:
  //   walletExpenseHistoryAll[walletId] = [{date, amountAbs, description, src}]
  const walletExpenseHistoryAll = {};
  wallets.forEach((w) => {
    walletExpenseHistoryAll[w.id] = [];
  });

  // 3a) native wallet expenses (negative amounts only, exclude transfers/deposits/withdrawals)
  wallets.forEach((w) => {
    (w.expenses || []).forEach((e) => {
      const amt = Number(e.amount || 0);
      if (!e?.date) return;
      if (isNonExpenseMovement(e.description)) return;
      if (amt < 0) {
        walletExpenseHistoryAll[w.id].push({
          date: e.date,
          amountAbs: Math.abs(amt),
          description: e.description || w.name,
          src: 'Wallet',
        });
      }
    });
  });

  // 3b) bills paid from a wallet → merge as wallet expenses
  (bills || []).forEach((b) => {
    if (!b?.paid) return;
    const when = b.paidAt || b.dueDate;
    if (!when) return;
    const wid = b.walletId || null;
    if (!wid) return; // only if paid via a wallet
    if (!walletExpenseHistoryAll[wid]) walletExpenseHistoryAll[wid] = [];
    walletExpenseHistoryAll[wid].push({
      date: when,
      amountAbs: Number(b.amount || 0),
      description: b.title || 'Bill',
      src: 'Bill',
    });
  });

  // 3c) subscriptions history paid from a wallet → merge as wallet expenses
  (payables || []).forEach((p) => {
    const wid = p.walletId || null;
    (p.history || []).forEach((h) => {
      const src = h.source || p.defaultSource || 'wallet';
      if (src !== 'wallet') return; // only those actually paid via a wallet
      if (!h?.date) return;
      if (!wid) return;
      if (!walletExpenseHistoryAll[wid]) walletExpenseHistoryAll[wid] = [];
      const amt = Number(h.amount ?? p.amount ?? 0);
      if (amt > 0) { // treat as spend
        walletExpenseHistoryAll[wid].push({
          date: h.date,
          amountAbs: amt,
          description: p.name || 'Subscription',
          src: 'Subscription',
        });
      }
    });
  });

  // Sort each wallet history newest→oldest
  Object.keys(walletExpenseHistoryAll).forEach((wid) => {
    walletExpenseHistoryAll[wid].sort((a, b) => new Date(b.date) - new Date(a.date));
  });

  // ===== 4) THIS MONTH itemized (kept for compatibility with old prompts) =====
  const walletExpenseDetailsThisMonth = {};
  wallets.forEach((w) => {
    const rows = [];
    (walletExpenseHistoryAll[w.id] || []).forEach((r) => {
      if (monthKey(r.date) === THIS_MONTH) rows.push(r);
    });
    walletExpenseDetailsThisMonth[w.id] = rows;
  });

  // ===== 5) top wallets by expense this month =====
  const topWallets = [...walletsSummary]
    .sort((a, b) => (b.usedThisMonth || 0) - (a.usedThisMonth || 0))
    .map((w) => ({ id: w.id, name: w.name, usedThisMonth: w.usedThisMonth }));

  // ===== 6) overspent list =====
  const overspentWallets = walletsSummary
    .filter((w) => w.cap && w.usedThisMonth > w.cap)
    .map((w) => ({ id: w.id, name: w.name, cap: w.cap, usedThisMonth: w.usedThisMonth, overBy: w.usedThisMonth - w.cap }));

  // ===== 7) upcoming bills/subs (separate blocks) =====
  const upcomingBills = [];
  (bills || []).forEach((b) => {
    const due = b.dueDate || b.paidAt || null;
    if (!due) return;
    upcomingBills.push({ name: b.title || 'Bill', amount: Number(b.amount || 0), dueDate: due, walletId: b.walletId || null });
  });

  const upcomingSubscriptions = [];
  (payables || []).forEach((p) => {
    if (p?.nextDueDate) {
      upcomingSubscriptions.push({ name: p.name || 'Subscription', amount: Number(p.amount || 0), dueDate: p.nextDueDate, walletId: p.walletId || null });
    }
  });

  // Total Funds = Remaining Cash (home) + sum(wallet balances)
  const totalFunds = Number(remainingCashHome || 0) + walletsSummary.reduce((s, w) => s + Number(w.balance || 0), 0);

    // ===== 8) Bills already paid (for RAG grounding) =====
  const billsPaidForRag = (bills || [])
    .filter((b) => b?.paid)
    .map((b) => ({
      name: b.title || b.name || 'Bill',
      description: b.description || b.title || b.name || 'Bill',
      amount: Number(b.amount || 0),
      date: b.paidAt || b.dueDate || '',
      walletId: b.walletId || null,
    }));


  return {
    remainingCashHome,
    totalFunds,
    walletsSummary,
    weeklyExpenses,
    walletExpenseHistoryAll,         // <— ALL-TIME wallet expenses (merged)
    walletExpenseDetailsThisMonth,   // kept for compatibility
    topWallets,
    overspentWallets,
    upcomingBills,
    upcomingSubscriptions,
    thisMonthSpendAll,
    billsPaidForRag,
  };
};

const buildAdvancedContext = async () => {
  const snap = await buildAdvancedSnapshot();
  const lines = [];

  lines.push('You are a budgeting copilot. Answer using ONLY the data below.\n');

  lines.push('=== REMAINING CASH (Home) ===');
  lines.push(`remainingCash=${snap.remainingCashHome}`);
  lines.push('');

  lines.push('=== TOTAL FUNDS ===');
  lines.push(`totalFunds=${snap.totalFunds}`);
  lines.push('');

  lines.push('=== WALLETS (balances, caps, usedThisMonth, remainingCap) ===');
  (snap.walletsSummary || []).forEach((w) => {
    lines.push(`- name="${w.name}" id=${w.id} balance=${w.balance} cap=${w.cap ?? 'null'} usedThisMonth=${w.usedThisMonth} remainingCap=${w.remainingCap ?? 'null'}`);
  });
  lines.push('');

  lines.push('=== WEEKLY_EXPENSES (last 7 days — wallets, bills, subscriptions, ledger; exclude savings) ===');
  if ((snap.weeklyExpenses || []).length === 0) {
    lines.push('(none)');
  } else {
    [...snap.weeklyExpenses]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach((tx) => {
        lines.push(`- date="${tx.date}" src=${tx.source} wallet="${tx.walletName || ''}" amount=${tx.amount} desc="${(tx.description || '').replace(/\n/g, ' ')}"`);
      });
  }
  lines.push('');

  // ===================== NEW: ALL-TIME WALLET EXPENSE HISTORY =====================
  lines.push('=== WALLET_EXPENSE_HISTORY_ALL (date, amount, description; bills/subs merged into wallet) ===');
  (snap.walletsSummary || []).forEach((w) => {
    const rows = snap.walletExpenseHistoryAll?.[w.id] || [];
    lines.push(`- wallet="${w.name}" id=${w.id} items=${rows.length}`);
    rows.forEach((r) =>
      lines.push(`  • date="${r.date}" amount=${r.amountAbs} desc="${(r.description || '').replace(/\n/g, ' ')}" src=${r.src}`)
    );
  });
  lines.push('');
  // ===============================================================================

  lines.push('=== WALLET_EXPENSE_DETAILS_THIS_MONTH ===');
  (snap.walletsSummary || []).forEach((w) => {
    const rows = snap.walletExpenseDetailsThisMonth?.[w.id] || [];
    lines.push(`- wallet="${w.name}" id=${w.id} items=${rows.length}`);
    rows.forEach((r) => lines.push(`  • date="${r.date}" amount=${r.amountAbs} desc="${(r.description || '').replace(/\n/g, ' ')}"`));
  });
  lines.push('');

  lines.push('=== TOP_WALLETS_BY_EXPENSE_THIS_MONTH ===');
  (snap.topWallets || []).forEach((w, idx) => lines.push(`${idx + 1}. "${w.name}" usedThisMonth=${w.usedThisMonth}`));
  lines.push('');

  lines.push('=== OVERSPENT_WALLETS ===');
  if ((snap.overspentWallets || []).length === 0) lines.push('(none)');
  else snap.overspentWallets.forEach((w) => lines.push(`- "${w.name}" cap=${w.cap} used=${w.usedThisMonth} overBy=${w.overBy}`));
  lines.push('');

  // separate sections
  lines.push('=== UPCOMING_BILLS ===');
  (snap.upcomingBills || [])
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .forEach((u) => lines.push(`- name="${u.name}" amount=${u.amount} dueDate="${u.dueDate}" walletId=${u.walletId ?? 'null'}`));
  lines.push('');

  lines.push('=== UPCOMING_SUBSCRIPTIONS ===');
  (snap.upcomingSubscriptions || [])
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .forEach((u) => lines.push(`- name="${u.name}" amount=${u.amount} dueDate="${u.dueDate}" walletId=${u.walletId ?? 'null'}`));
  lines.push('');

    lines.push('=== BILLS_PAID ===');
  if (!snap.billsPaidForRag || snap.billsPaidForRag.length === 0) {
    lines.push('(none)');
  } else {
    snap.billsPaidForRag
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((b) =>
        lines.push(
          `- name="${b.name}" desc="${(b.description || '').replace(/\n/g,' ')}" amount=${b.amount} date="${b.date}" walletId=${b.walletId ?? 'null'}`
        )
      );
  }
  lines.push('');

  
  lines.push(
    [
      'Answering rules:',
      '1) Use WALLET_EXPENSE_HISTORY_ALL for any questions about spending patterns, last month vs next payday projections, or “where did my money go” (search by date/amount/desc).',
      '2) Weekly summaries → use WEEKLY_EXPENSES.',
      '3) Wallet caps/overages → use WALLETS (cap, usedThisMonth, remainingCap) and OVERSPENT_WALLETS.',
      '4) Remaining cash → use REMAINING CASH (Home). Also list EACH wallet balance from WALLETS; do NOT sum them.',
      '5) Upcoming bills/subs → use UPCOMING_BILLS and UPCOMING_SUBSCRIPTIONS.',
      'Be concise, peso formatted, and avoid markdown styling.',
    ].join('\n')
  );

  return { text: lines.join('\n'), snapshot: snap };
};


function buildLocalFinancialAnswer(question, snapshot) {
  const q = String(question || '').toLowerCase();
  const snap = snapshot || {};
  const money = (n) => peso(Number(n || 0));

  if (q.includes('week')) {
    const rows = snap.weeklyExpenses || [];
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (!rows.length) return 'You have no recorded expenses in the last 7 days.';
    const recent = [...rows]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
      .map((row) => `${row.description || row.walletName || 'Expense'}: ${money(row.amount)}`)
      .join(' · ');
    return `You spent ${money(total)} in the last 7 days. Recent items: ${recent}.`;
  }

  if (q.includes('month') && (q.includes('spent') || q.includes('spend') || q.includes('expense'))) {
    return `Your recorded spending this month is ${money(snap.thisMonthSpendAll)}.`;
  }

  if (q.includes('closest') && q.includes('cap')) {
    const capped = (snap.walletsSummary || [])
      .filter((w) => Number(w.cap) > 0)
      .map((w) => ({ ...w, remaining: Number(w.cap) - Number(w.usedThisMonth || 0) }))
      .sort((a, b) => a.remaining - b.remaining);
    if (!capped.length) return 'No wallet caps are configured yet. Add monthly caps in Wallets to track budget pressure.';
    const w = capped[0];
    return `${w.name} is closest to its cap: ${money(w.usedThisMonth)} used out of ${money(w.cap)} (${money(Math.max(0, w.remaining))} remaining).`;
  }

  if (q.includes('over budget') || q.includes('overspent') || q.includes('over cap')) {
    const rows = snap.overspentWallets || [];
    if (!rows.length) return 'Good news — none of your capped wallets are currently over budget.';
    return rows
      .map((w) => `${w.name} is over by ${money(w.overBy ?? w.over ?? 0)}`)
      .join(' · ');
  }

  if (q.includes('top') && (q.includes('wallet') || q.includes('spending'))) {
    const rows = (snap.topWallets || []).slice(0, 3);
    if (!rows.length) return 'There is not enough spending data yet to rank your wallets.';
    return `Your top spending wallets this month are ${rows.map((w, i) => `${i + 1}) ${w.name} ${money(w.usedThisMonth)}`).join(', ')}.`;
  }

  if (q.includes('bill') || q.includes('subscription') || q.includes('due')) {
    const rows = [
      ...(snap.upcomingBills || []).map((x) => ({ ...x, kind: 'Bill' })),
      ...(snap.upcomingSubscriptions || []).map((x) => ({ ...x, kind: 'Subscription' })),
    ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 5);
    if (!rows.length) return 'You have no upcoming bills or subscriptions recorded.';
    return rows.map((x) => `${x.kind}: ${x.name} — ${money(x.amount)} due ${toYMD(x.dueDate)}`).join(' · ');
  }

  if (q.includes('recent') || q.includes('where did') || q.includes('expenses per wallet')) {
    const rows = [];
    Object.values(snap.walletExpenseHistoryAll || {}).forEach((items) => rows.push(...items));
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!rows.length) return 'No expense history is available yet.';
    return rows.slice(0, 6).map((x) => `${x.description || 'Expense'} ${money(x.amountAbs)} (${toYMD(x.date)})`).join(' · ');
  }

  const top = (snap.topWallets || [])[0];
  const next = [...(snap.upcomingBills || []), ...(snap.upcomingSubscriptions || [])]
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  return [
    `Remaining cash: ${money(snap.remainingCashHome)}.`,
    `This month’s spending: ${money(snap.thisMonthSpendAll)}.`,
    top ? `Highest-spend wallet: ${top.name} at ${money(top.usedThisMonth)}.` : '',
    next ? `Next payment: ${next.name} (${money(next.amount)}) due ${toYMD(next.dueDate)}.` : '',
  ].filter(Boolean).join(' ');
}

function buildLocalDailyAdvice(snapshot, aggs) {
  const overs = aggs?.overspentWallets || [];
  if (overs.length) {
    const top = [...overs].sort((a, b) => Number(b.over || 0) - Number(a.over || 0))[0];
    return `${top.name} is over its monthly cap by ${peso(top.over || 0)}. Consider pausing non-essential spending from that wallet until your next budget reset.`;
  }
  if (Number(snapshot?.total || 0) > 0) {
    return `You spent ${peso(snapshot.total)} yesterday${snapshot.topCategory ? `, mostly on ${snapshot.topCategory}` : ''}. Review one discretionary purchase today and redirect the same amount toward a savings goal.`;
  }
  return 'No spending was recorded yesterday. Use the quiet day to review upcoming bills and make sure your wallet caps still match your priorities.';
}

export default function AIScreen() {
  const navigation = useNavigation();

  const [prompt, setPrompt] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState('Ask a question about your finances.');

  // daily advice
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [advice, setAdvice] = useState('');

  // aggregates for chips
  const [stats, setStats] = useState({
    totalFunds: 0,
    totalBalance: 0,
    totalWalletSpendAll: 0,
    totalBillsPaidAll: 0,
    thisMonthSpend: 0,
    todaySpendTotal: 0,
    wallets: [],
    budgetWallets: [],
    budgetGlobal: {},
    lastMonthSpend: 0,
    lastMonthKey: '',
  });

  useEffect(() => {
    navigation.setOptions({ title: 'Pengpeng AI' });
  }, [navigation]);

  const buildAll = useCallback(async () => {
    await ensureRagKB();
    await rebuildKBFromStorage();

    const aggs = await computeAggregates();

    // Total Funds = Home Remaining Cash + sum(wallet balances)
    const remainingCashHome = Number((await getTotalBalance()) || 0);
    const wallets = (await getData('wallets')) || [];
    const sumWalletBalances = wallets.reduce((s, w) => s + Number(w.balance || 0), 0);
    const totalFunds = Number(remainingCashHome || 0) + sumWalletBalances;

    setStats({
      totalFunds,
      totalBalance: aggs.totalBalance,
      totalWalletSpendAll: aggs.totalWalletSpendAll,
      totalBillsPaidAll: aggs.totalBillsPaidAll,
      thisMonthSpend: aggs.thisMonthSpend,
      todaySpendTotal: aggs.todaySpendTotal,
      wallets: aggs.wallets,
      budgetWallets: aggs.budgetWallets,
      budgetGlobal: aggs.budgetGlobal,
      lastMonthSpend: aggs.lastMonthSpend,
      lastMonthKey: aggs.lastMonthKey,
    });
  }, []);

  useFocusEffect(useCallback(() => {
    buildAll().then(loadDailyAdvice);
  }, [buildAll]));

  const askAI = async (questionOverride = null) => {
    // React Native passes a press/submit event object into handlers.
    // Only treat questionOverride as a question when it is actually a string.
    // This prevents "[object Object]" from being placed into the input.
    const hasExplicitQuestion = typeof questionOverride === 'string';
    const q = String(
      hasExplicitQuestion ? questionOverride : prompt
    ).trim();

    if (!q) {
      Alert.alert(
        'Type a question',
        'Ask anything. Financial questions can use your balances, transactions, budgets, bills, income, goals, and spending patterns.'
      );
      return;
    }

    setLastQuestion(q);

    // Clear the composer after capturing the question so the next question
    // can be typed immediately.
    setPrompt('');

    setLoading(true);
    setResp('Analyzing your financial data…');

    try {
      const context = await buildFinancialAIContext({ question: q });

      let answer = '';

      if (isRemoteAIConfigured()) {
        try {
          const raw = await requestFinancialAI({
            prompt: context.prompt,
            temperature: 0.2,
          });

          answer = stripMd(raw);
        } catch (remoteError) {
          const local = buildFullLocalAnswer(q, context.data);

          answer = `${local}

Pengpeng's secure AI service could not be reached, so this answer used local analytics only.`;
        }
      } else {
        answer = buildFullLocalAnswer(q, context.data);
      }

      setResp(answer);

      try {
        await rememberFinancialAIExchange(q, answer);
      } catch {}
    } catch (error) {
      try {
        const context = await buildFinancialAIContext({ question: q });
        const fallback = buildFullLocalAnswer(q, context.data);
        setResp(fallback);
      } catch {
        setResp(
          'I could not read your financial data right now. Try refreshing the page and ask again.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const askFromSuggestion = async (q) => {
    await askAI(q);
  };

  // -------- Daily advice --------
  const loadDailyAdvice = async () => {
    try {
      const today = toYMD(new Date());
      const cached = (await getData(ADVICE_KEY)) || {};
      if (cached.date === today && cached.text) {
        setAdvice(cached.text);
        return;
      }
      await generateDailyAdvice();
    } catch {
      setAdvice('(Advice unavailable right now.)');
    }
  };

  const generateDailyAdvice = async () => {
    setAdviceLoading(true);

    try {
      const question =
        'Give me one short financial note for today based on my complete saved financial data, current spending patterns, upcoming bills, budget risk, payday schedule, and savings goals. Use 1–2 sentences and include one practical next action.';

      const context = await buildFinancialAIContext({ question });

      let text = '';

      if (isRemoteAIConfigured()) {
        try {
          text = await requestFinancialAI({
            prompt: context.prompt,
            temperature: 0.2,
          });
        } catch {
          text = buildFullLocalAnswer(
            'Based on my spending patterns, what should I improve?',
            context.data
          );
        }
      } else {
        text = buildFullLocalAnswer(
          'Based on my spending patterns, what should I improve?',
          context.data
        );
      }

      const clean = stripMd(text);

      await saveData(ADVICE_KEY, {
        date: toYMD(new Date()),
        text: clean,
      });

      setAdvice(clean);
    } catch {
      setAdvice(
        'Review your upcoming payments and the wallet closest to its cap before making discretionary purchases today.'
      );
    } finally {
      setAdviceLoading(false);
    }
  };

  const reload = async () => {
    await buildAll();
    await loadDailyAdvice();
    Alert.alert('Refreshed', 'Recomputed totals & advice.');
  };

  const remoteAI = isRemoteAIConfigured();



  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.compactTop}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: remoteAI ? palette.success : palette.cyan },
            ]}
          />
          <Text style={styles.statusText}>
            {remoteAI ? 'Pengpeng AI connected' : 'Local insights active'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={reload}
          style={styles.refreshButton}
          accessibilityLabel="Refresh financial data"
          activeOpacity={0.84}
        >
          <Ionicons name="refresh" size={19} color={palette.text} />
        </TouchableOpacity>
      </View>

      <LinearGradient
        colors={['#123D81', '#2D66F2', '#655CFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.snapshotHero}
      >
        <View style={styles.snapshotTop}>
          <View>
            <Text style={styles.snapshotKicker}>YOUR FINANCIAL SNAPSHOT</Text>
            <Text style={styles.snapshotAmount}>{peso(stats.totalFunds)}</Text>
            <Text style={styles.snapshotCaption}>Total funds available</Text>
          </View>

          <PengpengAvatar size={48} />
        </View>

        <View style={styles.snapshotStats}>
          <View style={styles.snapshotStat}>
            <Text style={styles.snapshotStatLabel}>Today</Text>
            <Text style={styles.snapshotStatValue}>{peso(stats.todaySpendTotal)}</Text>
          </View>

          <View style={styles.snapshotDivider} />

          <View style={styles.snapshotStat}>
            <Text style={styles.snapshotStatLabel}>This month</Text>
            <Text style={styles.snapshotStatValue}>{peso(stats.thisMonthSpend)}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.noteStrip}>
        <View style={styles.noteAvatar}>
          <PengpengAvatar size={36} />
        </View>

        <View style={styles.noteCopy}>
          <Text style={styles.noteLabel}>TODAY'S NOTE</Text>
          <Text style={styles.noteText} numberOfLines={4}>
            {adviceLoading
              ? 'Reviewing your latest data…'
              : advice || 'Refresh to generate a quick money note.'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={generateDailyAdvice}
          style={styles.noteRefresh}
          activeOpacity={0.84}
        >
          <Ionicons name="refresh" size={15} color={palette.sub} />
        </TouchableOpacity>
      </View>

      <View style={styles.askSection}>
        <Text style={styles.eyebrow}>ASK PENGPENG</Text>
        <Text style={styles.askTitle}>What do you want to know?</Text>

        <View style={styles.inputShell}>
          <TextInput
            placeholder="Ask Pengpeng anything about your finances…"
            placeholderTextColor={palette.muted}
            value={prompt}
            onChangeText={setPrompt}
            style={styles.input}
            selectionColor={palette.cyan}
            multiline
            returnKeyType="send"
            onSubmitEditing={() => askAI()}
          />

          <TouchableOpacity
            style={[styles.sendButton, loading && styles.disabled]}
            onPress={() => askAI()}
            disabled={loading}
            activeOpacity={0.86}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.quickGrid}>
          {QUICK_QUESTIONS.map((q) => (
            <TouchableOpacity
              key={q}
              style={styles.quickChip}
              activeOpacity={0.84}
              onPress={() => askFromSuggestion(q)}
            >
              <Text style={styles.quickChipText} numberOfLines={3}>
                {q}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={palette.cyan} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.answerSection}>
        <View style={styles.answerHeader}>
          <View>
            <Text style={styles.eyebrow}>PENGPENG'S INSIGHT</Text>
            <Text style={styles.answerTitle}>Pengpeng's answer</Text>
          </View>

          <View style={styles.groundedBadge}>
            <View style={styles.groundedDot} />
            <Text style={styles.groundedText}>Your data</Text>
          </View>
        </View>

        <View style={styles.answerAccent} />

        {lastQuestion ? (
          <View style={styles.lastQuestionWrap}>
            <Text style={styles.lastQuestionLabel}>YOU ASKED</Text>
            <Text style={styles.lastQuestionText}>{lastQuestion}</Text>
          </View>
        ) : null}

        <Text style={styles.answerText}>{resp}</Text>
      </View>

      <View style={styles.dataStrip}>
        <View style={styles.dataStripHeader}>
          <Ionicons name="layers-outline" size={15} color={palette.primaryStrong} />
          <Text style={styles.dataStripTitle}>Data used for this insight</Text>
        </View>

        <View style={styles.dataMetrics}>
          <SnapshotMetric
            label="Wallet spend"
            value={peso(stats.totalWalletSpendAll)}
          />
          <SnapshotMetric
            label="Bills paid"
            value={peso(stats.totalBillsPaidAll)}
          />
          <SnapshotMetric
            label="Last month"
            value={peso(stats.lastMonthSpend)}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function SnapshotMetric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  content: {
    paddingHorizontal: spacing.l,
    paddingTop: 6,
    paddingBottom: 138,
  },

  compactTop: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 7,
  },

  statusText: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
  },

  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  snapshotHero: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 17,
    overflow: 'hidden',
    ...shadow(9, 0.22),
  },

  snapshotTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    columnGap: 14,
  },

  snapshotKicker: {
    color: '#C7DEFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.35,
  },

  snapshotAmount: {
    color: '#fff',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -0.9,
    marginTop: 4,
  },

  snapshotCaption: {
    color: '#C5DAF7',
    fontSize: 11,
    marginTop: 1,
  },

  sparkOrb: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  snapshotStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },

  snapshotStat: {
    flex: 1,
  },

  snapshotStatLabel: {
    color: '#B7CCEA',
    fontSize: 9,
    fontWeight: '700',
  },

  snapshotStatValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },

  snapshotDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginHorizontal: 18,
  },

  noteStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  noteAvatar: {
    marginRight: 13,
    marginTop: 2,
  },

  noteCopy: {
    flex: 1,
    paddingRight: 12,
  },

  noteLabel: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.25,
    marginBottom: 4,
  },

  noteText: {
    color: palette.textSoft,
    fontSize: 12.5,
    lineHeight: 19,
  },

  noteRefresh: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bgSoft,
  },

  askSection: {
    paddingTop: 21,
  },

  eyebrow: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.35,
  },

  askTitle: {
    color: palette.text,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: -0.45,
    marginTop: 4,
    marginBottom: 12,
  },

  inputShell: {
    minHeight: 92,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
    padding: 14,
  },

  input: {
    minHeight: 50,
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
    paddingRight: 48,
    textAlignVertical: 'top',
  },

  sendButton: {
    position: 'absolute',
    right: 11,
    bottom: 11,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  disabled: {
    opacity: 0.55,
  },

  quickGrid: {
    paddingTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },

  quickChip: {
    width: '48.5%',
    minHeight: 76,
    borderRadius: 18,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },

  quickChipText: {
    flex: 1,
    color: palette.textSoft,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    paddingRight: 8,
  },

  answerSection: {
    marginTop: 23,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  answerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  answerTitle: {
    color: palette.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
    marginTop: 3,
  },

  groundedBadge: {
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.cyanSoft,
    flexDirection: 'row',
    alignItems: 'center',
  },

  groundedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.cyan,
    marginRight: 5,
  },

  groundedText: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '800',
  },

  answerAccent: {
    width: 40,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.cyan,
    marginTop: 14,
    marginBottom: 12,
  },

  lastQuestionWrap: {
    marginBottom: 13,
  },

  lastQuestionLabel: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.0,
    marginBottom: 4,
  },

  lastQuestionText: {
    color: palette.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },

  answerText: {
    color: palette.textSoft,
    fontSize: 13,
    lineHeight: 21,
  },

  dataStrip: {
    marginTop: 24,
    paddingTop: 17,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  dataStripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  dataStripTitle: {
    color: palette.textSoft,
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 6,
  },

  dataMetrics: {
    flexDirection: 'row',
  },

  metric: {
    flex: 1,
    paddingRight: 8,
  },

  metricLabel: {
    color: palette.muted,
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },

  metricValue: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 3,
  },
});
