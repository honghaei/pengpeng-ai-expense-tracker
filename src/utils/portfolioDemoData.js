// src/utils/portfolioDemoData.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveData } from './storage';

const pad = (n) => String(n).padStart(2, '0');

const isoFor = (daysOffset = 0, hour = 12, minute = 0) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString();
};

const monthDate = (day, monthOffset = 0, hour = 12) => {
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth() + monthOffset,
    Math.max(1, Math.min(28, day)),
    hour,
    0,
    0,
    0
  );
  return d.toISOString();
};

const ymd = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const goalSchedule = () => {
  const now = new Date();
  const rows = [];

  for (let i = -2; i < 4; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 5);
    const paid = i <= -1 ? 5000 : i === 0 ? 3000 : 0;

    rows.push({
      date: d.toISOString(),
      amount: 5000,
      amountPlanned: 5000,
      paid,
      confirmed: paid >= 5000,
    });
  }

  return rows;
};

const expense = (id, amount, description, category, daysAgo) => ({
  id,
  amount,
  description,
  category,
  date: isoFor(-daysAgo, 12 + (daysAgo % 6), 10),
  source: 'Wallet',
});

export async function seedPortfolioDemoData() {
  const wallets = [
    {
      id: 'w-food',
      name: 'Food & Drink',
      emoji: '🍽️',
      color: '#FFE9A8',
      balance: 4200,
      monthlyCap: 7000,
      expenses: [
        expense('food-1', 280, 'Lunch at cafe', 'Food & Drink', 0),
        expense('food-2', 420, 'Dinner', 'Food & Drink', 2),
        expense('food-3', 185, 'Coffee', 'Food & Drink', 4),
        expense('food-4', 650, 'Groceries', 'Food & Drink', 6),
        expense('food-5', 315, 'Lunch', 'Food & Drink', 8),
      ],
    },
    {
      id: 'w-transport',
      name: 'Transport',
      emoji: '🚌',
      color: '#CFE4FF',
      balance: 3150,
      monthlyCap: 4500,
      expenses: [
        expense('trans-1', 165, 'Ride to work', 'Transport', 1),
        expense('trans-2', 120, 'Train fare', 'Transport', 3),
        expense('trans-3', 310, 'Fuel', 'Transport', 5),
        expense('trans-4', 145, 'Ride home', 'Transport', 7),
      ],
    },
    {
      id: 'w-utilities',
      name: 'Utilities',
      emoji: '🧾',
      color: '#FFDCC9',
      balance: 5300,
      monthlyCap: 6500,
      expenses: [
        expense('util-1', 1699, 'Home internet', 'Bills & Utilities', 9),
        expense('util-2', 620, 'Water bill', 'Bills & Utilities', 12),
      ],
    },
    {
      id: 'w-leisure',
      name: 'Leisure',
      emoji: '📝',
      color: '#E9D7FF',
      balance: 2250,
      monthlyCap: 3500,
      expenses: [
        expense('leis-1', 550, 'Movie night', 'Entertainment', 5),
        expense('leis-2', 349, 'Game purchase', 'Entertainment', 11),
      ],
    },
    {
      id: 'w-health',
      name: 'Healthcare',
      emoji: '❤️',
      color: '#FFD7DA',
      balance: 3600,
      monthlyCap: 4000,
      expenses: [
        expense('health-1', 750, 'Vitamins', 'Health & Fitness', 10),
      ],
    },
    {
      id: 'w-others',
      name: 'Others',
      emoji: '🪙',
      color: '#E7EAF3',
      locked: true,
      balance: 1750,
      monthlyCap: 3000,
      expenses: [
        expense('other-1', 290, 'Phone accessories', 'Others', 13),
      ],
    },
    {
      id: 'goal-emergency',
      name: 'Emergency Fund',
      balance: 13000,
      expenses: [
        {
          id: 'goal-credit-1',
          amount: 5000,
          description: 'Goal contribution',
          category: 'Savings goal',
          date: monthDate(5, -2),
          goalId: 'goal-emergency',
          goalOp: 'pay',
        },
        {
          id: 'goal-credit-2',
          amount: 5000,
          description: 'Goal contribution',
          category: 'Savings goal',
          date: monthDate(5, -1),
          goalId: 'goal-emergency',
          goalOp: 'pay',
        },
        {
          id: 'goal-credit-3',
          amount: 3000,
          description: 'Goal contribution',
          category: 'Savings goal',
          date: monthDate(5, 0),
          goalId: 'goal-emergency',
          goalOp: 'pay',
        },
      ],
    },
  ];

  const totalBalance = 18750;

  const profile = {
    name: 'Charles',
    age: 22,
    incomeType: 'salary',
    monthlyIncome: 42000,
    onboardingComplete: true,
    habits: {
      top3: ['Food & Drink', 'Transport', 'Bills & Utilities'],
      exceedBudget: 'sometimes',
      spendDriver: 'mix',
    },
    alerts: {
      lowBalancePct: 20,
    },
    autoIncome: {
      enabled: true,
      days: [15, 30],
      type: 'salary',
      amount: 42000,
    },
  };

  const payables = [
    {
      id: 'demo-electricity',
      type: 'bill',
      name: 'Electricity',
      notes: '',
      amountType: 'variable',
      amount: 2350,
      category: 'Bills & Utilities',
      defaultSource: 'wallet',
      walletId: 'w-utilities',
      cadence: null,
      autopay: false,
      pausedUntil: null,
      trialEndDate: null,
      lastPaidDate: monthDate(12, -1),
      nextDueDate: isoFor(6, 9),
      remindDaysBefore: 1,
      history: [
        {
          date: monthDate(12, -1),
          amount: 2210,
          category: 'Bills & Utilities',
          source: 'wallet',
        },
      ],
    },
    {
      id: 'demo-water',
      type: 'bill',
      name: 'Water',
      notes: '',
      amountType: 'variable',
      amount: 620,
      category: 'Bills & Utilities',
      defaultSource: 'wallet',
      walletId: 'w-utilities',
      cadence: null,
      autopay: false,
      pausedUntil: null,
      trialEndDate: null,
      lastPaidDate: monthDate(5, -1),
      nextDueDate: isoFor(11, 9),
      remindDaysBefore: 1,
      history: [
        {
          date: monthDate(5, -1),
          amount: 590,
          category: 'Bills & Utilities',
          source: 'wallet',
        },
      ],
    },
    {
      id: 'demo-netflix',
      type: 'subscription',
      name: 'Netflix',
      notes: '',
      amountType: 'fixed',
      amount: 549,
      category: 'Subscriptions',
      defaultSource: 'total',
      walletId: null,
      cadence: { unit: 'month', every: 1 },
      autopay: true,
      pausedUntil: null,
      trialEndDate: null,
      lastPaidDate: monthDate(18, -1),
      nextDueDate: isoFor(8, 9),
      remindDaysBefore: 1,
      history: [
        {
          date: monthDate(18, -1),
          amount: 549,
          category: 'Subscriptions',
          source: 'total',
        },
      ],
    },
    {
      id: 'demo-spotify',
      type: 'subscription',
      name: 'Spotify',
      notes: '',
      amountType: 'fixed',
      amount: 149,
      category: 'Subscriptions',
      defaultSource: 'total',
      walletId: null,
      cadence: { unit: 'month', every: 1 },
      autopay: true,
      pausedUntil: null,
      trialEndDate: null,
      lastPaidDate: monthDate(2, 0),
      nextDueDate: isoFor(26, 9),
      remindDaysBefore: 1,
      history: [
        {
          date: monthDate(2, 0),
          amount: 149,
          category: 'Subscriptions',
          source: 'total',
        },
      ],
    },
  ];

  const schedule = goalSchedule();

  const goals = [
    {
      id: 'goal-emergency',
      name: 'Emergency Fund',
      target: 30000,
      months: schedule.length,
      deductFrom: 'total',
      goalWalletId: 'goal-emergency',
      schedule,
      createdAt: monthDate(1, -2),
      finishedAt: null,
    },
  ];

  const ledger = [
    {
      id: 'led-1',
      type: 'RECURRING_INCOME',
      source: 'SALARY',
      amount: 21000,
      date: monthDate(15, -1),
      note: 'Salary payday',
    },
    {
      id: 'led-2',
      type: 'TOTAL_EXPENSE_DEBIT',
      amount: 149,
      note: 'Spotify',
      category: 'Subscriptions',
      date: monthDate(2, 0),
      source: 'Total',
    },
  ];

  const transferEvents = [
    {
      type: 'transfer',
      direction: 'cash_to_wallet',
      walletId: 'w-food',
      amount: 5000,
      date: isoFor(-14),
    },
    {
      type: 'transfer',
      direction: 'cash_to_wallet',
      walletId: 'w-transport',
      amount: 3000,
      date: isoFor(-14),
    },
    {
      type: 'total_expense',
      amount: 149,
      category: 'Subscriptions',
      description: 'Spotify',
      date: monthDate(2, 0),
    },
  ];

  const balanceHistory = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return {
      date: ymd(d),
      total: 20200 + i * 430 - (i % 3) * 700,
    };
  });

  await Promise.all([
    saveData('wallets', wallets),
    saveData('total_balance', totalBalance),
    saveData('user_profile', profile),
    saveData('payables_v1', payables),
    saveData('goals', goals),
    saveData('ledger', ledger),
    saveData('recurring_incomes', [
      {
        id: 'demo-income-15',
        type: 'salary',
        amount: 21000,
        dayOfMonth: 15,
        lastApplied: null,
        enabled: true,
      },
      {
        id: 'demo-income-30',
        type: 'salary',
        amount: 21000,
        dayOfMonth: 30,
        lastApplied: null,
        enabled: true,
      },
    ]),
    saveData('wallet_auto_split', {
      allocationsPct: {
        'w-food': 25,
        'w-transport': 15,
        'w-utilities': 25,
        'w-leisure': 10,
        'w-health': 10,
        'w-others': 5,
        'goal-emergency': 10,
      },
      lastApplied: {},
    }),
    AsyncStorage.setItem('transferEvents', JSON.stringify(transferEvents)),
    AsyncStorage.setItem('balanceHistory', JSON.stringify(balanceHistory)),
  ]);

  return {
    ok: true,
    summary: {
      totalBalance,
      walletBalance: wallets.reduce(
        (sum, w) => sum + Number(w.balance || 0),
        0
      ),
      wallets: wallets.length,
      payables: payables.length,
      goals: goals.length,
    },
  };
}

export async function clearPortfolioDemoData() {
  const keys = [
    'wallets',
    'total_balance',
    'user_profile',
    'payables_v1',
    'goals',
    'ledger',
    'recurring_incomes',
    'wallet_auto_split',
    'transferEvents',
    'balanceHistory',
    'ai_daily_advice_v1',
  ];

  await AsyncStorage.multiRemove(keys);
  return { ok: true };
}
