// src/screens/HomeScreen.js
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  Dimensions,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Toast from 'react-native-root-toast';
import { Calendar } from 'react-native-calendars';
import * as Notifications from 'expo-notifications';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Path,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';

import { getData, saveData } from '../utils/storage';
import { getTotalBalance, adjustTotalBalance } from '../utils/ledger';
import { ensureDefaultWallets, DEFAULT_WALLETS } from '../utils/walletDefaults';

// budgets + helpers for caps/usage
import { getBudgets, THIS_MONTH, monthKey } from '../utils/budgets';
import { checkAndNotifyAfterExpense } from '../utils/budgetAlerts';

import TxnRow from '../components/TxnRow';

// ✅ Shared RAG used by AIScreen too
import * as RAG from '../utils/rag';

// ✅ ADD: read payables so bill/subscription payments count in month expense
import { listPayables } from '../utils/payables';
import { requestFinancialAI, isRemoteAIConfigured } from '../services/aiClient';
import { palette } from '../theme/design';
import PengpengAvatar from '../components/PengpengAvatar';

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');

const toYMD = (d) => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

const isSameMonth = (d, y, mIdx) => {
  const dt = new Date(d);
  return !isNaN(dt) && dt.getFullYear() === y && dt.getMonth() === mIdx;
};

// Safe timestamp (invalid dates sink to bottom)
const ts = (d) => {
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : -Infinity;
};

// Timestamp "YYYY-MM-DD HH:mm"
const two = (n) => (n < 10 ? `0${n}` : `${n}`);
const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

// ---- AI helpers (dates, goals normalizer) ----
const ymd = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? ''
    : `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const tryNumber = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// try multiple keys so we don't break if the store name differs
const loadSavingsGoals = async () => {
  const candidates = ['savings_goals', 'savingsGoals', 'goals', 'savings'];
  for (const key of candidates) {
    const val = await getData(key);
    if (Array.isArray(val) && val.length) return val;
  }
  return [];
};

const monthsBetween = (from, to) => {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};

const normGoal = (g) => {
  const name = g?.name || g?.title || 'Goal';
  const target = tryNumber(g?.target ?? g?.targetAmount ?? g?.amount ?? g?.goal, 0);
  const saved = tryNumber(g?.saved ?? g?.savedSoFar ?? g?.balance ?? g?.current ?? 0, 0);
  const perMonth = tryNumber(g?.perMonth ?? g?.monthly ?? g?.monthlyAmount, 0) || null;
  const startDate = g?.startDate || g?.createdAt || null;
  const targetDate = g?.targetDate || g?.dueDate || g?.endDate || null;

  const remaining = Math.max(0, target - saved);

  let monthsLeft = null;
  if (perMonth) monthsLeft = Math.ceil(remaining / perMonth);
  if (!monthsLeft && targetDate) {
    const m = monthsBetween(new Date(), targetDate);
    if (m !== null) monthsLeft = Math.max(0, m);
  }

  const monthlyNeeded = monthsLeft && monthsLeft > 0 ? remaining / monthsLeft : null;

  return {
    name,
    target,
    saved,
    remaining,
    perMonth,
    monthsLeft,
    monthlyNeeded,
    startDate,
    targetDate,
  };
};

// --- RAG helpers (NEW) ---
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const withinLastNDays = (date, n) => {
  const t = new Date(date);
  if (Number.isNaN(t)) return false;
  return t >= startOfDay(daysAgo(n)) && t <= new Date();
};

// Try common keys used by Profile screen for "remaining cash" (cash on hand).
// Falls back to total balance if none is found.
const loadProfileRemainingCash = async (fallbackValue) => {
  const keys = [
    'profile_remaining_cash',
    'remaining_cash',
    'remainingCash',
    'cashOnHand',
    'cash_balance',
    'profile.cashOnHand',
  ];
  for (const k of keys) {
    const v = await getData(k);
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  const profile = (await getData('user_profile')) || {};
  const cand = Number(
    profile.remainingCash ??
      profile.cashOnHand ??
      profile.cash_balance ??
      profile?.balances?.cash ??
      NaN
  );
  if (Number.isFinite(cand)) return cand;
  return Number(fallbackValue || 0);
};

/* === Home budget tile (same behavior as WalletDetailScreen) === */

const walletVisual = (name = '') => {
  const key = String(name).toLowerCase();

  if (key.includes('food')) return { icon: 'restaurant-outline', color: '#4FD9FF' };
  if (key.includes('transport')) return { icon: 'car-sport-outline', color: '#6EA8FF' };
  if (key.includes('utilit')) return { icon: 'flash-outline', color: '#7A8CFF' };
  if (key.includes('leisure')) return { icon: 'game-controller-outline', color: '#A98BFF' };
  if (key.includes('health')) return { icon: 'heart-outline', color: '#61D8C5' };

  return { icon: 'grid-outline', color: '#8AA4C6' };
};

const peso = (value, digits = 2) =>
  `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;

const compactPeso = (value) => {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `₱${(n / 1000).toFixed(1)}K`;
  return `₱${Math.round(n).toLocaleString()}`;
};

function BudgetTileHS({ meta, used, cap, onPress }) {
  const ratio = cap
    ? Math.max(0, Math.min(1, Number(used || 0) / Number(cap)))
    : 0;

  const { icon, color } = walletVisual(meta?.name);
  const percentage = cap ? Math.round(ratio * 100) : 0;
  const remaining = cap ? Math.max(0, Number(cap) - Number(used || 0)) : null;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={styles.budgetCompact}
    >
      <View style={[styles.budgetIconRing, { borderColor: `${color}55` }]}>
        <View style={[styles.budgetIconCore, { backgroundColor: `${color}18` }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
      </View>

      <Text style={styles.budgetCompactName} numberOfLines={1}>
        {meta?.name}
      </Text>

      <Text style={styles.budgetCompactValue}>
        {cap ? `${percentage}%` : compactPeso(used)}
      </Text>

      <Text style={styles.budgetCompactMeta} numberOfLines={1}>
        {cap
          ? `${compactPeso(remaining)} left`
          : `${compactPeso(used)} spent`}
      </Text>
    </TouchableOpacity>
  );
}

function SpendingSparkline({ values = [] }) {
  const width = 320;
  const height = 86;
  const topPad = 8;
  const bottomPad = 12;

  const clean = values.length ? values : [0, 0];
  const max = Math.max(...clean, 1);
  const step = clean.length > 1 ? width / (clean.length - 1) : width;

  const points = clean.map((value, index) => {
    const x = index * step;
    const usable = height - topPad - bottomPad;
    const y = height - bottomPad - (Number(value || 0) / max) * usable;
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
    >
      <Defs>
        <SvgLinearGradient id="homeChartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#4FD9FF" stopOpacity="0.38" />
          <Stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>

      <Path d={areaPath} fill="url(#homeChartFill)" />
      <Path
        d={linePath}
        fill="none"
        stroke="#78E2FF"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// === Profile low-balance settings helper (top-level, used by loadEverything) ===
const getLowBalanceSettings = async () => {
  const profile = (await getData('user_profile')) || {};

  // Accept percent as "20", "20%", or 0.2 → 20
  const pctCandidates = [
    profile.lowBalancePercent,
    profile.lowBalancePct,
    profile.lowBalanceAlertPct,
    profile.lowBalanceAlert,
    profile.alertLowBalancePct,
    profile.alerts?.lowBalancePercent,
    profile.prefs?.lowBalancePercent,
    profile.settings?.lowBalancePercent,
  ].filter(v => v !== undefined && v !== null);

  const allowanceCandidates = [
    profile.monthlyAllowance,
    profile.allowance,
    profile.monthlyBudget,
    profile.incomeMonthly,
    profile.budgetMonthly,
    profile.income?.monthly,
    profile.prefs?.monthlyAllowance,
  ].filter(v => v !== undefined && v !== null);

  const parsePct = (x) => {
    const s = String(x ?? '').trim();
    const m = s.match(/([\d.]+)/);
    if (!m) return NaN;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return NaN;
    return (n > 0 && n <= 1) ? n * 100 : n; // 0.2 => 20
  };

  const parseNum = (x) => {
    const n = Number(String(x ?? '').replace(/[,₱\s]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };

  let pct = 0;
  for (const c of pctCandidates) {
    const n = parsePct(c);
    if (Number.isFinite(n) && n > 0) { pct = n; break; }
  }

  let allowance = 0;
  for (const c of allowanceCandidates) {
    const n = parseNum(c);
    if (Number.isFinite(n) && n > 0) { allowance = n; break; }
  }

  return { pct, allowance };
};


export default function HomeScreen() {
  const navigation = useNavigation();

  const [total, setTotal] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [monthExpense, setMonthExpense] = useState(0);
  const [todayExpense, setTodayExpense] = useState(0);
  // flags to know if AI returned valid numbers
const [aiHasToday, setAiHasToday] = useState(false);
const [aiHasMonth, setAiHasMonth] = useState(false);
const [lowBalance, setLowBalance] = useState({ threshold: 0, isLow: false, pct: 0 });
const lowAlertShownRef = useRef(false); // prevent spamming the toast




  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`);

  const [transactions, setTransactions] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [budgets, setBudgets] = useState(null);

  // per-wallet this-month usage
  const [usage, setUsage] = useState({});

  const [lastDeleted, setLastDeleted] = useState(null);

  // Add Cash modal state
  const [addVisible, setAddVisible] = useState(false);
  const [addAmount, setAddAmount] = useState('');
  const [addTarget, setAddTarget] = useState('total'); // 'total' | 'wallet'
  const [addWalletId, setAddWalletId] = useState(null);

  // per-wallet Add Expense modal
  const [tileModal, setTileModal] = useState({ visible: false, walletId: null, walletName: '' });
  const [tileAmount, setTileAmount] = useState('');
  const [tileDesc, setTileDesc] = useState('');
  // 🔒 prevent double-submit lag/spam on Deduct
  const [tileSubmitting, setTileSubmitting] = useState(false);

  const scaleLeft = useRef(new Animated.Value(1)).current;
  const scaleRight = useRef(new Animated.Value(1)).current;

  // Calendar modal
  const [calOpen, setCalOpen] = useState(false);

  // ==== AI Quick Chat modal state ====
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResp, setAiResp] = useState('Ask me about your wallets, caps, remaining, or overspend.');
  const [aiLoading, setAiLoading] = useState(false);

  // ==== Quick prompts (carousel) ====
  const AI_SUGGESTIONS = [
    'How much did I spend this month?',
    'Which wallet is closest to its cap?',
    'What are my top 3 categories this month?',
    'What can I safely spend today?',
    'Any bills due in the next 7 days?',
    'How much remaining cash do I have?',
    'Where did I overspend?',
    'Suggest ways to cut ₱1,000 this week.',
  ];

  const suggRef = useRef(null);
  const autoTimerRef = useRef(null);
  const scrollXRef = useRef(0);
  const [suggContainerW, setSuggContainerW] = useState(0);
  const contentWRef = useRef(0);

  const stopAutoSuggestions = useCallback(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const startAutoSuggestions = useCallback(() => {
    stopAutoSuggestions();
    if (!suggRef.current || contentWRef.current <= suggContainerW + 4) return;

    autoTimerRef.current = setInterval(() => {
      const max = Math.max(0, contentWRef.current - suggContainerW);
      scrollXRef.current += 1.5;
      if (scrollXRef.current >= max) scrollXRef.current = 0;
      suggRef.current.scrollTo({ x: scrollXRef.current, animated: false });
    }, 16);
  }, [suggContainerW, stopAutoSuggestions]);

  useEffect(() => {
    if (aiOpen) startAutoSuggestions();
    else stopAutoSuggestions();
    return stopAutoSuggestions;
  }, [aiOpen, startAutoSuggestions, stopAutoSuggestions]);

      // Ask for notification permissions once
    useEffect(() => {
      (async () => {
        const settings = await Notifications.getPermissionsAsync();
        if (!settings.granted) {
          await Notifications.requestPermissionsAsync();
        }
      })();
    }, []);

    // Re-show a toast every 10s while low balance is true
    useEffect(() => {
      let timer = null;
      if (lowBalance.isLow) {
        // show immediately
        Toast.show(
          `⚠️ Remaining cash is low (≤ ₱${Number(lowBalance.threshold || 0).toFixed(2)} — ${lowBalance.pct}% of your allowance)`,
          { duration: 3500, position: Toast.positions.TOP }
        );
        // keep showing periodically
        timer = setInterval(() => {
          Toast.show(
            `⚠️ Remaining cash is low (≤ ₱${Number(lowBalance.threshold || 0).toFixed(2)} — ${lowBalance.pct}% of your allowance)`,
            { duration: 3500, position: Toast.positions.TOP }
          );
        }, 10000); // every 10s
      }
      return () => { if (timer) clearInterval(timer); };
    }, [lowBalance.isLow, lowBalance.threshold, lowBalance.pct]);



  const bounceIn = (ref) =>
    Animated.spring(ref, { toValue: 1.06, useNativeDriver: true }).start();

  const bounceOut = (ref) =>
    Animated.spring(ref, { toValue: 1, useNativeDriver: true }).start();

  /* --------- load base data + ensure 6 wallets --------- */
  const loadEverything = async () => {
    const homeProfile = (await getData('user_profile')) || {};
    setProfileName(homeProfile?.name || '');

    const t = await getTotalBalance();
    setTotal(Number(t || 0));

        // === Low balance alert check (Profile settings) ===
    try {
      const { pct, allowance } = await getLowBalanceSettings();
      const threshold = (Number.isFinite(pct) && pct > 0 && Number.isFinite(allowance) && allowance > 0)
        ? allowance * (pct / 100)
        : 0;

      const current = Number(t || 0); // "t" is your remaining cash from getTotalBalance()
      const isLow = threshold > 0 && current <= threshold;

      setLowBalance({ threshold, isLow, pct });

      // Phone (system) notification once per low state entry
      if (isLow && !lowAlertShownRef.current) {
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'Low remaining cash',
              body: `Balance ₱${current.toFixed(2)} is at/below ₱${threshold.toFixed(2)} (${pct}% of your monthly allowance).`,
              sound: true,
              priority: Notifications.AndroidNotificationPriority.HIGH,
            },
            trigger: null,
          });
        } catch {}
        lowAlertShownRef.current = true;
      } else if (!isLow) {
        // reset the one-shot gate so we can notify again if it dips low later
        lowAlertShownRef.current = false;
      }
    } catch {}




    const ensured = await ensureDefaultWallets();
    setWallets(ensured);

    const b = await getBudgets();
    setBudgets(b);

    const bills = (await getData('bills')) || [];
    const ledger = (await getData('ledger')) || [];
    const payables = await listPayables().catch(() => []);
    // hidden ids (we don't delete data, we just hide by id)
    const hiddenIds = (await getData('hidden_tx_ids')) || [];
    const hiddenSet = new Set(hiddenIds);
    let all = [];

    const sig = new Set();
    const makeSig = (desc, amount, date) => {
      const d = new Date(date);
      const round = isNaN(d) ? String(date) : d.toISOString().slice(0, 16);
      return `${(desc || '').trim().toLowerCase()}|${Number(amount) || 0}|${round}`;
    };
    const pushTxn = (tx) => {
      // hide if user chose to hide this transaction id
      if (tx?.id && hiddenSet.has(tx.id)) return;

      // Deduplicate by content (desc + wallet + amount + rounded datetime)
      // This collapses bill + wallet duplicates into one
      const desc = (tx.description || '').trim().toLowerCase();
      const amt  = Number(tx.amount || 0);
      const s = makeSig(`${desc}|${tx.walletId || ''}`, amt, tx.date);
      if (sig.has(s)) return;
      sig.add(s);
      all.push(tx);
    };
    


    ensured.forEach((w) => {
      (w.expenses || []).forEach((exp) => {
        pushTxn({
          id: exp.id,
          walletName: w.name,
          walletId: w.id,
          category: w.name,
          amount: Number(exp.amount),
          date: exp.date,
          source: 'Wallet',
          description: exp.description || w.name,
        });
      });
    });

    bills
      .filter((b2) => b2.paid)
      .forEach((b2) => {
        const wn = ensured.find((ww) => ww.id === b2.walletId)?.name || 'Wallet';
        const paidTime = b2.paidAt || b2.dueDate || nowStamp();
        pushTxn({
          id: `bill:${b2.id}:${paidTime}`,
          walletName: wn,
          walletId: b2.walletId,
          category: b2.title || 'Bill',
          amount: -Math.abs(Number(b2.amount || 0)),
          date: paidTime,
          source: 'Bill',
          description: b2.title || 'Bill',
        });
      });

    payables.forEach((p) => {
      (p.history || []).forEach((h, idx) => {
        const when = h.date || p.lastPaidDate;
        if (!when) return;
        if (monthKey(when) !== THIS_MONTH) return;

        const src = h.source || p.defaultSource || 'wallet';
        const wId = src === 'wallet' ? (p.walletId || null) : null;
        const wName =
          src === 'wallet'
            ? (ensured.find((ww) => ww.id === wId)?.name || 'Wallet')
            : 'Total Balance';

        pushTxn({
          id: `payhist:${p.id}:${idx}:${when}`,
          walletName: wName,
          walletId: wId,
          category: p.category || 'Bill',
          amount: Number(h.amount ?? p.amount ?? 0),
          date: when,
          source: src === 'wallet' ? 'Wallet' : 'Total',
          description: p.name,
        });
      });
    });

    ledger
      .filter((r) => r.type === 'TOTAL_EXPENSE')
      .forEach((r) => {
        pushTxn({
          id: r.id,
          walletName: 'Total Balance',
          walletId: null,
          category: r.category || 'Expense',
          amount: Number(r.amount || 0),
          date: r.date,
          source: 'Total',
          description: r.description || 'Expense',
        });
      });

    all.sort((a, b2) => ts(b2.date) - ts(a.date));
    setTransactions(all);

    const usageMap = {};
    let monthSum = 0;

for (const w of ensured) {
  let used = 0;

  // 1) Wallet expenses this month (exclude internal transfers/deposits/withdraws)
  (w.expenses || []).forEach((e) => {
    if (!e?.date || monthKey(e.date) !== THIS_MONTH) return;
    const val = Number(e.amount || 0);
    const desc = (e.description || '').toLowerCase();
    const isNonExpense =
      desc.includes('wallet transfer') ||
      desc.includes('deposit') ||
      desc.includes('withdraw');
    if (isNonExpense) return;
    if (val < 0) used += Math.abs(val);
  });

  // 2) ALWAYS include Bills paid from this wallet this month
  (bills || [])
    .filter(
      (bb) =>
        bb.paid &&
        bb.walletId === w.id &&
        (bb.paidAt || bb.dueDate) &&
        monthKey(bb.paidAt || bb.dueDate) === THIS_MONTH
    )
    .forEach((bb) => {
      used += Number(bb.amount || 0);
    });

  // 3) ALWAYS include Subscriptions/Payables charged to this wallet this month
  (payables || []).forEach((p) => {
    // only count those that actually hit this wallet
    const src = p.defaultSource || 'wallet';
    if (src !== 'wallet' || (p.walletId || null) !== w.id) return;

    (p.history || []).forEach((h) => {
      const when = h?.date;
      if (!when || monthKey(when) !== THIS_MONTH) return;
      const amt = Number(h.amount ?? p.amount ?? 0);
      if (amt > 0) used += amt;
    });
  });

  // Sum for the "This Month's Expense" card
  monthSum += used;

  // Cap math for the tile
  const cap =
    Number(b?.byWallet?.[w.id]?.walletCap ?? w.monthlyCap ?? 0) || null;
  const pct = cap ? Math.min(150, Math.round((used / cap) * 100)) : 0;
  const over = cap ? Math.max(0, used - cap) : 0;

  usageMap[w.id] = { used, cap, pct, over };
}


    setMonthExpense(monthSum);
    setUsage(usageMap);
  };

  // Pull the same aggregates AIScreen uses; only apply when valid
const loadAggregatesForHome = useCallback(async () => {
  try {
    const aggs = await RAG.computeAggregates(); // { todaySpendTotal, thisMonthSpend }

    const m = Number(aggs?.thisMonthSpend);
    if (Number.isFinite(m)) {
      setMonthExpense(m);
      setAiHasMonth(true);
    } else {
      setAiHasMonth(false);
    }

    // Today is intentionally calculated from the local transaction list
    // so it matches the calendar exactly. RAG remains responsible for the
    // monthly aggregate only.
    setAiHasToday(false);
  } catch {
    setAiHasMonth(false);
    setAiHasToday(false);
  }
}, []);


  useFocusEffect(
  useCallback(() => {
    (async () => {
      await loadEverything();       // local
      await loadAggregatesForHome(); // AI (only if valid)
    })();
  }, [loadAggregatesForHome])
);


  // Keep "Today" on the Overview in sync with the same transaction data
  // used by the calendar. This avoids relying on the AI aggregate for the
  // dashboard's daily total.
  useEffect(() => {
    const todayKey = toYMD(new Date());
    if (!todayKey) return;

    let total = 0;

    transactions.forEach((tx) => {
      if (toYMD(tx.date) !== todayKey) return;

      const desc = String(tx.description || '').toLowerCase();

      const isNonExpense =
        desc.includes('wallet transfer') ||
        desc.includes('deposit') ||
        desc.includes('withdraw');

      if (isNonExpense) return;

      const raw = Number(tx.amount || 0);
      if (!Number.isFinite(raw)) return;

      total += Math.abs(raw);
    });

    setTodayExpense(total);
    setAiHasToday(false);
  }, [transactions]);



/* --------- recompute monthly totals for calendar (display only) --------- */
const { year: curYear, monthIndex: curMonthIdx } = useMemo(() => {
  const d = new Date(currentMonth);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}, [currentMonth]);

const dailyTotals = useMemo(() => {
  const map = {};

  transactions.forEach((tx) => {
    if (!isSameMonth(tx.date, curYear, curMonthIdx)) return;

    const desc = (tx.description || '').toLowerCase();
    // Non-expense lines excluded (same as AI)
    if (
      desc.includes('wallet transfer') ||
      desc.includes('deposit') ||
      desc.includes('withdraw')
    ) return;

    const key = toYMD(tx.date);
    const raw = Number(tx.amount || 0);
    const amt = raw < 0 ? -raw : raw; // show positive spend in calendar
    map[key] = (map[key] || 0) + amt;
  });

  return map;
}, [transactions, curYear, curMonthIdx]);

  /* --------- delete / undo --------- */
const handleDeleteTransaction = async (item) => {
  // remember last item so we can undo
  setLastDeleted(item);
  Toast.show('Hidden! Tap to undo', {
    duration: 5000,
    position: Toast.positions.BOTTOM,
    onPress: handleUndo,
  });

  // Just mark as hidden; do NOT change balances or stored transactions
  const hidden = (await getData('hidden_tx_ids')) || [];
  if (!hidden.includes(item.id)) {
    hidden.push(item.id);
    await saveData('hidden_tx_ids', hidden);
  }

  loadEverything();
};


const handleUndo = async () => {
  const item = lastDeleted;
  if (!item) return;

  // Unhide: remove id from hidden list
  const hidden = (await getData('hidden_tx_ids')) || [];
  const next = hidden.filter((hid) => hid !== item.id);
  await saveData('hidden_tx_ids', next);

  loadEverything();
  setLastDeleted(null);
};


  const renderRightActions = (item) => (
    <TouchableOpacity
      style={styles.deleteButton}
      onPress={() => handleDeleteTransaction(item)}
    >
      <Text style={{ color: '#fff', padding: 10 }}>Delete</Text>
    </TouchableOpacity>
  );

  /* --------- Add Cash (Total or Wallet) --------- */
  const openAddCash = () => {
    setAddAmount('');
    setAddTarget('total');
    setAddWalletId(null);
    setAddVisible(true);
  };
  const closeAddCash = () => setAddVisible(false);

  const confirmAddCash = async () => {
    const val = Number(addAmount);
    if (!val || val <= 0)
      return Alert.alert('Invalid amount', 'Enter a positive number.');

    if (addTarget === 'total') {
      await adjustTotalBalance(val);
    } else {
      if (!addWalletId) {
        return Alert.alert('Choose a wallet', 'Select which wallet to deposit into.');
      }
      const ws = (await getData('wallets')) || [];
      const w = ws.find((x) => x.id === addWalletId);
      if (!w) return Alert.alert('Wallet not found', 'Please pick a valid wallet.');

      const dep = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        amount: Math.abs(val), // positive = deposit
        date: nowStamp(),
        category: w.name,
        source: 'Wallet',
        description: 'Deposit',
      };
      const newW = {
        ...w,
        balance: Number(w.balance || 0) + val,
        expenses: [...(w.expenses || []), dep],
      };
      const updated = ws.map((x) => (x.id === w.id ? newW : x));
      await saveData('wallets', updated);
    }

    await loadEverything();
    closeAddCash();
  };

  /* --------- Wallet tile → add expense --------- */
  const openTileModal = (walletId, walletName) => {
    setTileModal({ visible: true, walletId, walletName });
    setTileAmount('');
    setTileDesc('');
    setTileSubmitting(false); // reset submit lock on open
  };
  const closeTileModal = () => {
    setTileModal({ visible: false, walletId: null, walletName: '' });
    setTileAmount('');
    setTileDesc('');
    setTileSubmitting(false);
  };

  const confirmTileExpense = async () => {
    if (tileSubmitting) return; // 🔒 guard against spam
    setTileSubmitting(true);

    try {
      const amt = Number(tileAmount);
      const desc = (tileDesc || '').trim();

      if (!desc)
        return Alert.alert('Missing description', 'Please enter what this expense is for.');
      if (!amt || amt <= 0)
        return Alert.alert('Invalid amount', 'Please enter a positive number.');

      const ws = (await getData('wallets')) || [];
      const w = ws.find((x) => x.id === tileModal.walletId);
      if (!w) return closeTileModal();

      const curr = Number(w.balance || 0);
      if (amt > curr) {
        return Alert.alert('Not enough wallet balance', 'Try a smaller amount.');
      }

      const exp = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        amount: -Math.abs(amt),
        date: nowStamp(),
        category: w.name,
        source: 'Wallet',
        description: desc,
      };

      const newW = {
        ...w,
        balance: curr - amt,
        expenses: [...(w.expenses || []), exp],
      };

      const updated = ws.map((x) => (x.id === w.id ? newW : x));
      await saveData('wallets', updated);

      const fired = await checkAndNotifyAfterExpense().catch(() => ({}));

      setTileAmount('');
      setTileDesc('');
      closeTileModal();
      await loadEverything();

      if (fired?.alerts?.length) {
        const first = fired.alerts[0];
        Toast.show(`${first.title}\n${first.body}`, {
          duration: 4000,
          position: Toast.positions.TOP,
          shadow: true,
          animation: true,
          hideOnPress: true,
        });
      }
    } finally {
      setTileSubmitting(false);
    }
  };

  /* --------- redesigned home summary --------- */
  const chartValues = useMemo(() => {
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    return Array.from({ length: days }, (_, index) => {
      const key = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(index + 1)}`;
      return Number(dailyTotals[key] || 0);
    });
  }, [dailyTotals]);

  const HeaderCards = () => (
    <View style={styles.heroWrap}>
      <LinearGradient
        colors={['#0B2346', '#123E84', '#245FD7', '#338FF2']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.balanceHero,
          lowBalance.isLow && styles.balanceHeroLow,
        ]}
      >
        <View style={styles.balanceHeroTop}>
          <View>
            <Text style={styles.balanceLabel}>Total balance</Text>
            <Text style={styles.balanceValue}>{peso(total)}</Text>
          </View>

          <TouchableOpacity
            style={styles.addCashOrb}
            onPress={openAddCash}
            activeOpacity={0.82}
          >
            <Ionicons name="add" size={26} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.balanceMetaRow}>
          <View style={styles.balanceMetaPill}>
            <Ionicons name="calendar-outline" size={14} color="#CBEFFF" />
            <Text style={styles.balanceMetaText}>
              {compactPeso(monthExpense)} spent this month
            </Text>
          </View>

          {lowBalance.isLow ? (
            <View style={styles.lowBalanceInline}>
              <View style={styles.lowBalanceDot} />
              <Text style={styles.lowBalanceInlineText}>
                Low balance
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.chartWrap}>
          <SpendingSparkline values={chartValues} />
        </View>

        <View style={styles.heroFooter}>
          <View>
            <Text style={styles.heroFooterLabel}>Today</Text>
            <Text style={styles.heroFooterValue}>{peso(todayExpense)}</Text>
          </View>

          <TouchableOpacity
            style={styles.calendarLink}
            onPress={() => setCalOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.calendarLinkText}>View calendar</Text>
            <Ionicons
              name="arrow-forward"
              size={15}
              color={palette.cyan}
            />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );

  /* --------- compact category budgets --------- */
  const WalletGrid = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.budgetScroller}
    >
      {DEFAULT_WALLETS.map((d) => {
        const u = usage[d.id] || { used: 0, cap: null, over: 0 };

        return (
          <BudgetTileHS
            key={d.id}
            meta={d}
            used={u.used || 0}
            cap={u.cap ?? null}
            onPress={() => openTileModal(d.id, d.name)}
          />
        );
      })}
    </ScrollView>
  );

  // calendar “marked dates”
  const calendarMarkedDates = useMemo(() => {
    const marked = {};
    Object.entries(dailyTotals).forEach(([date, amt]) => {
      if (amt > 0) marked[date] = { marked: true };
    });
    return marked;
  }, [dailyTotals]);

  const renderDay = ({ date, state }) => {
    const key = date.dateString;
    const amt = dailyTotals[key] || 0;
    return (
      <View style={[styles.dayCell, state === 'disabled' && { opacity: 0.35 }]}>
        <Text style={styles.dayNumber}>{date.day}</Text>
        {amt > 0 ? (
          <Text style={styles.dayAmount}>₱{amt.toLocaleString()}</Text>
        ) : (
          <Text style={styles.dayAmountEmpty}> </Text>
        )}
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View style={styles.welcomeRow}>
        <View style={styles.welcomeCopy}>
          <Text style={styles.welcomeOverline}>GOOD MORNING</Text>
          <Text style={styles.welcomeName}>
            {profileName || 'there'} <Text style={styles.wave}>👋</Text>
          </Text>
          <Text style={styles.welcomeSub}>
            Here&apos;s your financial snapshot.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.notificationButton}
          activeOpacity={0.8}
          onPress={() => {
            try {
              navigation.navigate('Profile');
            } catch {}
          }}
        >
          <Ionicons
            name="notifications-outline"
            size={20}
            color={palette.text}
          />
        </TouchableOpacity>
      </View>

      <HeaderCards />

      <View style={styles.sectionHeadingLine}>
        <View>
          <Text style={styles.eyebrow}>SPENDING THIS MONTH</Text>
          <Text style={styles.sectionTitleSmall}>Category breakdown</Text>
        </View>

        <TouchableOpacity
          style={styles.inlineAction}
          onPress={() => navigation.navigate('Wallet', { screen: 'WalletList' })}
        >
          <Text style={styles.inlineActionText}>Manage</Text>
          <Ionicons
            name="chevron-forward"
            size={15}
            color={palette.cyan}
          />
        </TouchableOpacity>
      </View>

      <WalletGrid />

      <View style={[styles.sectionHeadingLine, styles.activityHeading]}>
        <View>
          <Text style={styles.eyebrow}>RECENT ACTIVITY</Text>
          <Text style={styles.sectionTitleSmall}>Latest transactions</Text>
        </View>
      </View>
    </View>
  );

  /* ==== AI snapshot (ground truth for RAG) ==== */
  const buildAiSnapshot = useCallback(async () => {
    // 0) Core stores
    const totalBalanceLedger = Number((await getTotalBalance()) || 0);
    const walletsStore = (await getData('wallets')) || [];
    const billsStore   = (await getData('bills'))   || [];       // legacy Bills
    const payables     = await listPayables().catch(() => []);   // subscriptions/payables
    const ledger       = (await getData('ledger')) || [];        // total-balance expenses
    const budgets      = await getBudgets();

    // 1) Remaining cash from profile (not a sum of wallets)
    const profileRemainingCash = await loadProfileRemainingCash(totalBalanceLedger);

    // Read "low balance" settings from Profile (robust key lookup)
const getLowBalanceSettings = async () => {
  const profile = (await getData('user_profile')) || {};

  // percentage the user set (try multiple keys to be resilient)
  const pctRaw =
    profile.lowBalancePercent ??
    profile.lowBalancePct ??
    profile.lowBalanceAlertPct ??
    profile.lowBalanceAlert ??
    profile.alertLowBalancePct ??
    0;

  // user's monthly allowance (try multiple keys to be resilient)
  const allowanceRaw =
    profile.monthlyAllowance ??
    profile.allowance ??
    profile.monthlyBudget ??
    profile.incomeMonthly ??
    0;

  const pct = Number(pctRaw);
  const allowance = Number(allowanceRaw);

  return {
    pct: Number.isFinite(pct) ? pct : 0,
    allowance: Number.isFinite(allowance) ? allowance : 0,
  };
};


    // 2) Per-wallet balances & caps + this-month usage
    const includeBillsInUsage = !!budgets?.flags?.includeBills;
    const capsByWallet = budgets?.byWallet || {};
    const walletsSummary = [];
    let thisMonthSpendAll = 0;

    for (const w of walletsStore) {
      const cap = Number(capsByWallet?.[w.id]?.walletCap ?? w.monthlyCap ?? NaN);
      const capVal = Number.isFinite(cap) && cap > 0 ? cap : null;

      let usedThisMonth = 0;

      (w.expenses || []).forEach((e) => {
        if (!e?.date) return;
        const desc = (e.description || '').toLowerCase();
        const isNonExpense =
          desc.includes('wallet transfer') || desc.includes('deposit') || desc.includes('withdraw');
        const amt = Number(e.amount || 0);
        if (!isNonExpense && amt < 0 && monthKey(e.date) === THIS_MONTH) {
          usedThisMonth += Math.abs(amt);
        }
      });

      if (includeBillsInUsage) {
        billsStore
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
        cap: capVal,
        usedThisMonth,
        remainingCap: capVal ? Math.max(0, capVal - usedThisMonth) : null,
      });
    }

    // 3) Week view — ALL expenses across features (wallet debits, bills payments, subscriptions),
    //    exclude savings goals by design.
    const weeklyExpenses = [];

    // Wallet expenses (negative only) with description
    walletsStore.forEach((w) => {
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

    // Bills (paid last 7 days)
    billsStore
      .filter((b) => b.paid && (b.paidAt || b.dueDate) && withinLastNDays(b.paidAt || b.dueDate, 7))
      .forEach((b) => {
        const wn = walletsStore.find((ww) => ww.id === b.walletId)?.name || 'Wallet';
        weeklyExpenses.push({
          source: 'Bill',
          walletId: b.walletId || null,
          walletName: wn,
          amount: Number(b.amount || 0),
          date: b.paidAt || b.dueDate,
          description: b.title || 'Bill',
        });
      });

    // Subscriptions/Payables history in last 7 days
    (payables || []).forEach((p) => {
      (p.history || []).forEach((h) => {
        if (!h?.date || !withinLastNDays(h.date, 7)) return;
        const src = h.source || p.defaultSource || 'wallet';
        const wId = src === 'wallet' ? p.walletId || null : null;
        const wName =
          src === 'wallet'
            ? (walletsStore.find((ww) => ww.id === wId)?.name || 'Wallet')
            : 'Total Balance';
        weeklyExpenses.push({
          source: src === 'wallet' ? 'Wallet' : 'Total',
          walletId: wId,
          walletName: wName,
          amount: Number(h.amount ?? p.amount ?? 0),
          date: h.date,
          description: p.name || 'Subscription',
        });
      });
    });

    // Total-balance ledger expenses in last 7 days
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

    // 4) Top wallets by expense (THIS MONTH)
    const topWallets = [...walletsSummary]
      .sort((a, b) => (b.usedThisMonth || 0) - (a.usedThisMonth || 0))
      .map((w) => ({ id: w.id, name: w.name, usedThisMonth: w.usedThisMonth }));

    // 5) Overspends vs caps
    const overspentWallets = walletsSummary
      .filter((w) => w.cap && w.usedThisMonth > w.cap)
      .map((w) => ({
        id: w.id,
        name: w.name,
        cap: w.cap,
        usedThisMonth: w.usedThisMonth,
        overBy: w.usedThisMonth - w.cap,
      }));

    // 6) Upcoming bills & subscriptions (for "next 3 or 7 days")
    const upcoming = [];
    (billsStore || []).forEach((b) => {
      const due = b.dueDate || b.paidAt || null;
      if (!due) return;
      upcoming.push({
        source: 'Bill',
        name: b.title || 'Bill',
        amount: Number(b.amount || 0),
        dueDate: due,
        walletId: b.walletId || null,
      });
    });
    (payables || []).forEach((p) => {
      if (p?.nextDueDate) {
        upcoming.push({
          source: 'Subscription',
          name: p.name || 'Subscription',
          amount: Number(p.amount || 0),
          dueDate: p.nextDueDate,
          walletId: p.walletId || null,
        });
      }
    });

    // 7) NEW: Per-wallet expense details (THIS MONTH) for itemized answers
    const walletExpenseDetailsThisMonth = {}; // { [walletId]: [{date, amountAbs, description}] }
    walletsStore.forEach((w) => {
      const rows = [];
      (w.expenses || []).forEach((e) => {
        const amt = Number(e.amount || 0);
        if (!e?.date) return;
        const desc = (e.description || '').toLowerCase();
        const isNonExpense =
          desc.includes('wallet transfer') || desc.includes('deposit') || desc.includes('withdraw');
        if (isNonExpense) return;
        if (amt < 0 && monthKey(e.date) === THIS_MONTH) {
          rows.push({
            date: e.date,
            amountAbs: Math.abs(amt),
            description: e.description || w.name,
          });
        }
      });
      walletExpenseDetailsThisMonth[w.id] = rows.sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );
    });

    return {
      // Remaining cash (Profile)
      remainingCashFromProfile: profileRemainingCash,

      // Wallet balances & caps
      walletsSummary, // [{id,name,balance,cap,usedThisMonth,remainingCap}]

      // Weekly cross-feature expenses with descriptions
      weeklyExpenses, // [{source,walletName,amount,date,description}]

      // Top wallets by expense (this month)
      topWallets,

      // Overspends vs caps
      overspentWallets,

      // Upcoming bills/subscriptions
      upcoming, // [{source,name,amount,dueDate,walletId}]

      // Itemized per-wallet expense rows (this month)
      walletExpenseDetailsThisMonth,

      // Compatibility summary
      totalBalance: totalBalanceLedger,
      thisMonthSpend: thisMonthSpendAll,
      capsByWallet: Object.fromEntries(
        Object.entries(capsByWallet || {}).map(([id, v]) => [id, Number(v?.walletCap ?? NaN) || null])
      ),
    };
  }, []);

  // Build both structured & text context for RAG (answers come ONLY from here)
  const buildRagContextObject = async () => {
    const profile = (await getData('user_profile')) || {};
    const snap = await buildAiSnapshot();

    const peso = (n) =>
      `₱${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

    const lines = [];
    lines.push('You are a budgeting copilot. Answer using ONLY the data below.');
    lines.push('');

    // === Remaining cash rules ===
    lines.push('=== REMAINING CASH (from Profile screen, not a sum) ===');
    lines.push(`remainingCash=${peso(snap.remainingCashFromProfile)}`);
    lines.push('');

    // === Wallet balances and caps ===
    lines.push('=== WALLETS (separate balances, caps, and monthly usage) ===');
    (snap.walletsSummary || []).forEach((w) => {
      const cap = w.cap == null ? 'null' : w.cap;
      const rem = w.remainingCap == null ? 'null' : w.remainingCap;
      lines.push(
        `- name="${w.name}" id=${w.id} balance=${w.balance} cap=${cap} usedThisMonth=${w.usedThisMonth} remainingCap=${rem}`
      );
    });
    lines.push('');

    // === Weekly expenses across all features ===
    lines.push('=== WEEKLY_EXPENSES (last 7 days; exclude savings) ===');
    if ((snap.weeklyExpenses || []).length === 0) {
      lines.push('(none)');
    } else {
      [...snap.weeklyExpenses]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach((tx) => {
          lines.push(
            `- date="${tx.date}" src=${tx.source} wallet="${tx.walletName || ''}" amount=${tx.amount} desc="${(tx.description || '').replace(/\n/g, ' ')}"`
          );
        });
    }
    lines.push('');

    // === Top wallets by expense (this month) ===
    lines.push('=== TOP_WALLETS_BY_EXPENSE_THIS_MONTH ===');
    (snap.topWallets || []).forEach((w, idx) => {
      lines.push(`${idx + 1}. "${w.name}" usedThisMonth=${w.usedThisMonth}`);
    });
    lines.push('');

    // === Overspending vs caps ===
    lines.push('=== OVERSPENT_WALLETS (used > cap) ===');
    if ((snap.overspentWallets || []).length === 0) {
      lines.push('(none)');
    } else {
      snap.overspentWallets.forEach((w) => {
        lines.push(
          `- "${w.name}" cap=${w.cap} used=${w.usedThisMonth} overBy=${w.overBy}`
        );
      });
    }
    lines.push('');

    // === Upcoming bills and subscriptions (AI can filter 3 or 7 days) ===
    lines.push('=== UPCOMING_BILLS_AND_SUBSCRIPTIONS ===');
    (snap.upcoming || [])
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .forEach((u) => {
        lines.push(
          `- type=${u.source} name="${u.name}" amount=${u.amount} dueDate="${u.dueDate}" walletId=${u.walletId ?? 'null'}`
        );
      });
    lines.push('');

    // === PER-WALLET EXPENSE DETAILS (THIS MONTH) ===
    lines.push('=== WALLET_EXPENSE_DETAILS_THIS_MONTH ===');
    (snap.walletsSummary || []).forEach((w) => {
      const rows = snap.walletExpenseDetailsThisMonth?.[w.id] || [];
      lines.push(`- wallet="${w.name}" id=${w.id} items=${rows.length}`);
      rows.forEach((r) => {
        lines.push(
          `  • date="${r.date}" amount=${r.amountAbs} desc="${(r.description || '').replace(/\n/g, ' ')}"`
        );
      });
    });
    lines.push('');

    // Keep a small summary for compatibility
    lines.push('=== SUMMARY ===');
    lines.push(`totalBalanceLedger=${peso(snap.totalBalance)}`);
    lines.push(`thisMonthExpense=${peso(snap.thisMonthSpend)}`);
    lines.push('');

    // Guidance for the model to answer the exact questions you asked for
    lines.push(
      [
        'Answering rules:',
        '1) "All expenses in the week" → Use WEEKLY_EXPENSES list (include source, wallet, description).',
        '2) "Which wallet is closest to its cap / status of all wallets" → Use WALLETS section (cap, usedThisMonth, remainingCap).',
        '3) "How much remaining cash do I have?" → Use REMAINING CASH (single number from Profile). Also list each wallet balance from WALLETS; do NOT sum them.',
        '4) "Where did ₱X go?" → Search WEEKLY_EXPENSES and WALLET_EXPENSE_DETAILS_THIS_MONTH for matching amounts and show descriptions.',
        '5) "Top 3/5 categories" → Use TOP_WALLETS_BY_EXPENSE_THIS_MONTH (wallets are categories).',
        '6) "Where did I overspend" → Use OVERSPENT_WALLETS.',
        '7) "Bills for next 3 or 7 days" → Filter UPCOMING_BILLS_AND_SUBSCRIPTIONS by dueDate within that window.',
        '8) "What are the expenses of <wallet>?" → Use WALLET_EXPENSE_DETAILS_THIS_MONTH (date, amount, description) and show the subtotal for this month.',
        'Always answer with concise bullets and peso formatting.',
      ].join('\n')
    );

    return {
      profile,
      snapshot: snap,
      text: lines.join('\n'),
    };
  };

  // Ask Pengpeng (local retrieval first, optional remote AI fallback)
  const askAI = async (qOverride) => {
    const q = (qOverride ?? aiPrompt).trim();
    if (!q) {
      Alert.alert('Type a question', 'Ask about wallets, caps, remaining, or overspend.');
      return;
    }

    setAiLoading(true);
    setAiResp('…thinking…');

    try {
      // 1) Shared RAG (same as AIScreen)
      let answer = null;
      try {
        const ctx = await buildRagContextObject();
        if (typeof RAG?.askWithContext === 'function') {
          answer = await RAG.askWithContext(q, { context: ctx });
        } else if (typeof RAG?.ask === 'function') {
          try {
            answer = await RAG.ask(q, { context: ctx.text });
          } catch {
            answer = await RAG.ask(`${ctx.text}\n\nUSER QUESTION: ${q}`);
          }
        }
      } catch {
        // fall back
      }

      if (answer && String(answer).trim()) {
        setAiResp(String(answer).trim());
        return;
      }

      // 2) Secure remote AI fallback. If no proxy is configured, use a concise local summary.
      const ctx = await buildRagContextObject();
      const promptText = [
        'You are a helpful budgeting assistant for a mobile app.',
        'Ground your answer in the data blocks below.',
        '',
        ctx.text,
        '',
        `USER QUESTION: ${q}`,
      ].join('\n');

      if (isRemoteAIConfigured()) {
        try {
          const fallbackText = await requestFinancialAI({ prompt: promptText, temperature: 0.2 });
          setAiResp(fallbackText);
        } catch {
          setAiResp(`Remaining cash: ${peso(ctx.snapshot?.remainingCashHome || 0)} · This month: ${peso(ctx.snapshot?.thisMonthSpendAll || 0)}. Live AI is temporarily unavailable.`);
        }
      } else {
        setAiResp(`Remaining cash: ${peso(ctx.snapshot?.remainingCashHome || 0)} · This month: ${peso(ctx.snapshot?.thisMonthSpendAll || 0)}. Configure the optional secure AI proxy for conversational answers.`);
      }
    } catch (e) {
      setAiResp(`Error: ${String(e?.message || e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  const runSuggestion = (text) => {
    setAiPrompt(text);
    askAI(text);
  };

  /* --------- UI --------- */
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        contentContainerStyle={{ backgroundColor: palette.bg, flexGrow: 1, paddingBottom: 164 }}
        style={{ backgroundColor: palette.bg }}
        data={transactions.slice(0, 10)}
        keyExtractor={(item, index) => {
          if (item?.id) return `${item.source || 'X'}:${item.id}`;
          return `${item.source || 'X'}:${item.walletId || 'NA'}:${item.date || 'NA'}:${index}`;
        }}
        ListHeaderComponent={renderHeader}
        renderItem={({ item }) => (
          <Swipeable renderRightActions={() => renderRightActions(item)}>
            <TxnRow item={item} />
          </Swipeable>
        )}
        ListEmptyComponent={<Text style={styles.noTransactions}>No transactions yet.</Text>}
      />

      {/* Floating AI Button */}
      <TouchableOpacity
        onPress={() => setAiOpen(true)}
        style={styles.fab}
        activeOpacity={0.9}
      >
        <LinearGradient
          colors={['#315EEA', '#4A7CFF', '#4FD9FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabGradient}
        >
          <PengpengAvatar size={24} />
          <Text style={styles.fabLabel}>Pengpeng</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Add Cash Modal (Total or Wallet) */}
      <Modal transparent visible={addVisible} animationType="fade" onRequestClose={closeAddCash}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Cash</Text>

              {/* destination toggle */}
              <View style={styles.segmentWrap}>
                <TouchableOpacity
                  style={[styles.segmentBtn, addTarget === 'total' && styles.segmentActive]}
                  onPress={() => setAddTarget('total')}
                >
                  <Text style={[styles.segmentTxt, addTarget === 'total' && styles.segmentTxtActive]}>
                    Total Balance
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segmentBtn, addTarget === 'wallet' && styles.segmentActive]}
                  onPress={() => setAddTarget('wallet')}
                >
                  <Text style={[styles.segmentTxt, addTarget === 'wallet' && styles.segmentTxtActive]}>
                    Wallet
                  </Text>
                </TouchableOpacity>
              </View>

              {addTarget === 'wallet' ? (
                <View style={styles.walletChipsRow}>
                  {wallets.map((w) => (
                    <TouchableOpacity
                      key={w.id}
                      onPress={() => setAddWalletId(w.id)}
                      style={[
                        styles.walletChip,
                        addWalletId === w.id && styles.walletChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.walletChipTxt,
                          addWalletId === w.id && styles.walletChipTxtActive,
                        ]}
                      >
                        {w.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <TextInput
                placeholder="₱0.00"
                placeholderTextColor={palette.sub}
                keyboardType="numeric"
                value={addAmount}
                onChangeText={setAddAmount}
                returnKeyType="done"
                onSubmitEditing={confirmAddCash}
                style={styles.input}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
                <TouchableOpacity
                  onPress={closeAddCash}
                  style={[styles.smallBtn, { backgroundColor: palette.surface3 }]}
                >
                  <Text style={{ color: '#fff' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmAddCash}
                  style={[styles.smallBtn, { backgroundColor: palette.primary, marginLeft: 8 }]}
                >
                  <Text style={{ color: '#fff' }}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Per-wallet Add Expense modal */}
      <Modal transparent visible={tileModal.visible} animationType="fade" onRequestClose={closeTileModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Expense — {tileModal.walletName}</Text>

              <TextInput
                placeholder="Description (e.g., Burger, Bus fare)"
                placeholderTextColor={palette.sub}
                value={tileDesc}
                onChangeText={setTileDesc}
                style={styles.input}
                returnKeyType="next"
              />

              <TextInput
                placeholder="₱0.00"
                placeholderTextColor={palette.sub}
                keyboardType="numeric"
                value={tileAmount}
                onChangeText={setTileAmount}
                returnKeyType="done"
                onSubmitEditing={confirmTileExpense}
                style={styles.input}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={closeTileModal}
                  style={[styles.smallBtn, { backgroundColor: palette.surface3 }]}
                  disabled={tileSubmitting}
                >
                  <Text style={{ color: '#fff' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmTileExpense}
                  disabled={tileSubmitting}
                  style={[
                    styles.smallBtn,
                    { backgroundColor: '#e54848', marginLeft: 8 },
                    tileSubmitting && { opacity: 0.65 },
                  ]}
                >
                  {tileSubmitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff' }}>Deduct</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Calendar Modal */}
      <Modal transparent visible={calOpen} animationType="fade" onRequestClose={() => setCalOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setCalOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback onPress={() => { /* keep open */ }}>
              <View style={[styles.modalCard, { width: '92%' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={[styles.modalTitle, { flex: 1 }]}>Monthly Calendar</Text>
                  <TouchableOpacity onPress={() => setCalOpen(false)} style={styles.minBtn}>
                    <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>−</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ height: 6 }} />

                <Calendar
                  current={currentMonth}
                  onMonthChange={(m) => setCurrentMonth(`${m.year}-${pad(m.month)}-01`)}
                  dayComponent={renderDay}
                  markedDates={calendarMarkedDates}
                  theme={{
                    backgroundColor: 'transparent',
                    calendarBackground: 'transparent',
                    textSectionTitleColor: '#929BAA',
                    monthTextColor: '#fff',
                    arrowColor: palette.cyan,
                    todayTextColor: palette.cyan,
                  }}
                  style={{ alignSelf: 'stretch' }}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ==== AI Quick Chat Modal ==== */}
      <Modal transparent visible={aiOpen} animationType="fade" onRequestClose={() => setAiOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={[styles.modalCard, { width: '92%' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={[styles.modalTitle, { flex: 1 }]}>Pengpeng — Quick Chat</Text>
                <TouchableOpacity onPress={() => setAiOpen(false)} style={styles.minBtn}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>×</Text>
                </TouchableOpacity>
              </View>

              {/* Suggestions carousel */}
              <View
                style={styles.suggWrap}
                onLayout={(e) => setSuggContainerW(e.nativeEvent.layout.width)}
              >
                <ScrollView
                  ref={suggRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggContent}
                  onContentSizeChange={(w) => {
                    contentWRef.current = w;
                  }}
                  scrollEventThrottle={16}
                  onScrollBeginDrag={stopAutoSuggestions}
                  onScrollEndDrag={() => setTimeout(startAutoSuggestions, 600)}
                >
                  {AI_SUGGESTIONS.map((q) => (
                    <TouchableOpacity key={q} style={styles.suggChip} onPress={() => runSuggestion(q)}>
                      <Text style={styles.suggChipTxt}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Response box */}
              <View
                style={{
                  maxHeight: 240,
                  borderWidth: 1,
                  borderColor: palette.hairline,
                  borderRadius: 10,
                  padding: 10,
                  backgroundColor: palette.surface,
                }}
              >
                <ScrollView>
                  <Text style={{ color: palette.textSoft }}>{aiResp}</Text>
                </ScrollView>
              </View>

              {/* Ask input + button */}
              <View style={{ marginTop: 10 }}>
                <TextInput
                  placeholder="Ask Pengpeng about your money…"
                  placeholderTextColor={palette.sub}
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                  style={styles.input}
                  returnKeyType="send"
                  onSubmitEditing={() => askAI()}
                />
                <TouchableOpacity
                  style={[styles.askBtn, aiLoading && { opacity: 0.6 }]}
                  onPress={() => askAI()}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.askLabel}>Ask Pengpeng</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  headerContainer: {
    paddingTop: 8,
    backgroundColor: palette.bg,
  },

  welcomeRow: {
    marginHorizontal: 18,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  welcomeCopy: {
    flex: 1,
    paddingRight: 10,
  },

  welcomeOverline: {
    color: palette.cyan,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.4,
  },

  welcomeName: {
    color: palette.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
    marginTop: 4,
  },

  wave: {
    fontSize: 24,
  },

  welcomeSub: {
    color: palette.sub,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },

  notificationButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  heroWrap: {
    marginHorizontal: 16,
    marginBottom: 24,
  },

  balanceHero: {
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(116, 210, 255, 0.26)',
    shadowColor: '#2C7BFF',
    shadowOpacity: 0.24,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 13 },
    elevation: 9,
  },

  balanceHeroLow: {
    borderColor: 'rgba(255, 107, 122, 0.7)',
  },

  balanceHeroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  balanceLabel: {
    color: 'rgba(236, 247, 255, 0.78)',
    fontSize: 12,
    fontWeight: '700',
  },

  balanceValue: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 5,
  },

  addCashOrb: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },

  balanceMetaRow: {
    minHeight: 34,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  balanceMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(3, 15, 34, 0.23)',
  },

  balanceMetaText: {
    color: '#DDF5FF',
    fontSize: 11,
    fontWeight: '700',
  },

  lowBalanceInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  lowBalanceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.danger,
  },

  lowBalanceInlineText: {
    color: '#FFE2E6',
    fontSize: 10,
    fontWeight: '800',
  },

  chartWrap: {
    height: 86,
    marginTop: 10,
    marginHorizontal: -2,
    opacity: 0.98,
  },

  heroFooter: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  heroFooterLabel: {
    color: 'rgba(230, 244, 255, 0.66)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  heroFooterValue: {
    color: '#FFFFFF',
    marginTop: 3,
    fontSize: 15,
    fontWeight: '800',
  },

  calendarLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },

  calendarLinkText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: '800',
  },

  sectionHeadingLine: {
    marginHorizontal: 18,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  eyebrow: {
    color: palette.primaryStrong,
    fontWeight: '800',
    fontSize: 9,
    letterSpacing: 1.4,
    marginBottom: 5,
  },

  sectionTitle: {
    color: palette.text,
    fontWeight: '800',
    fontSize: 24,
    letterSpacing: -0.4,
  },

  sectionTitleSmall: {
    color: palette.text,
    fontWeight: '800',
    fontSize: 20,
    letterSpacing: -0.25,
  },

  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
  },

  inlineActionText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: '800',
  },

  budgetScroller: {
    paddingHorizontal: 18,
    paddingBottom: 2,
  },

  budgetCompact: {
    width: 76,
    marginRight: 12,
    alignItems: 'center',
  },

  budgetIconRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: palette.bgSoft,
  },

  budgetIconCore: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  budgetCompactName: {
    maxWidth: 76,
    marginTop: 8,
    color: palette.textSoft,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
  },

  budgetCompactValue: {
    marginTop: 4,
    color: palette.text,
    fontSize: 13,
    fontWeight: '800',
  },

  budgetCompactMeta: {
    maxWidth: 76,
    marginTop: 2,
    color: palette.muted,
    fontSize: 9,
    textAlign: 'center',
  },

  activityHeading: {
    marginTop: 26,
    marginBottom: 6,
  },

  noTransactions: {
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 26,
    color: palette.muted,
    fontSize: 13,
  },

  deleteButton: {
    backgroundColor: palette.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 82,
    borderRadius: 14,
    marginVertical: 5,
  },

  fab: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    borderRadius: 23,
    overflow: 'hidden',
    shadowColor: '#2B72FF',
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },

  fabGradient: {
    minHeight: 46,
    minWidth: 108,
    paddingHorizontal: 13,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  fabLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11.5,
  },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 7, 15, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },

  modalCard: {
    backgroundColor: palette.cardStrong,
    width: '92%',
    maxWidth: 460,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.text,
  },

  input: {
    minHeight: 50,
    backgroundColor: palette.surface,
    color: palette.text,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  smallBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
  },

  minBtn: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: palette.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  askBtn: {
    backgroundColor: palette.primary,
    paddingVertical: 13,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 8,
  },

  askLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },

  suggWrap: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 14,
    backgroundColor: palette.surface,
    paddingVertical: 8,
  },

  suggContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },

  suggChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: palette.surface2,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    marginHorizontal: 5,
  },

  suggChipTxt: {
    color: palette.textSoft,
    fontWeight: '700',
    fontSize: 11,
  },

  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: 4,
    marginTop: 10,
  },

  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: 'center',
  },

  segmentActive: {
    backgroundColor: palette.surface3,
  },

  segmentTxt: {
    color: palette.sub,
    fontWeight: '700',
  },

  segmentTxtActive: {
    color: palette.text,
  },

  walletChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },

  walletChip: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: palette.surface2,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    marginRight: 6,
    marginBottom: 6,
  },

  walletChipActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },

  walletChipTxt: {
    color: palette.textSoft,
    fontWeight: '700',
    fontSize: 11,
  },

  walletChipTxtActive: {
    color: '#FFFFFF',
  },

  dayCell: {
    width: 44,
    height: 52,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },

  dayNumber: {
    color: palette.text,
    fontWeight: '700',
    marginTop: 4,
  },

  dayAmount: {
    fontSize: 10,
    color: palette.warn,
    marginTop: 2,
  },

  dayAmountEmpty: {
    fontSize: 10,
    color: 'transparent',
    marginTop: 2,
  },

  // Legacy names kept for safety while the remaining screens/modals are
  // migrated to the Pengpeng v2 design system.
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 18,
    marginBottom: 12,
  },

  sectionHeaderRow: {
    marginHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },

  viewAllBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },

  viewAllTxt: {
    color: palette.textSoft,
    fontWeight: '800',
    fontSize: 11,
  },

  card: {
    backgroundColor: palette.card,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: palette.hairline,
    minHeight: 124,
  },

  cardLow: {
    borderColor: palette.danger,
  },

  cardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: palette.sub,
  },

  bigNumber: {
    fontSize: 25,
    fontWeight: '800',
    color: palette.text,
    marginTop: 9,
  },

  cardHint: {
    fontSize: 11,
    color: palette.primaryStrong,
    marginTop: 6,
    fontWeight: '700',
  },

  plusBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  plusBtnLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },

  lowPill: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255,107,122,0.14)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,107,122,0.35)',
  },

  lowPillTxt: {
    color: palette.danger,
    fontWeight: '800',
    fontSize: 10,
  },

  grid: {
    marginHorizontal: 20,
  },

  tileOuter: {
    width: 88,
  },

  tileCard: {
    borderRadius: 18,
  },

  fillClip: {
    overflow: 'hidden',
  },

  fill: {
    backgroundColor: palette.primarySoft,
  },

  tileTitle: {
    color: palette.text,
  },

  tileEmoji: {
    fontSize: 20,
  },

  tileAmount: {
    color: palette.text,
  },

  tooltipWrap: {},
  tooltip: {},
  tooltipTxt: {
    color: '#FFFFFF',
  },

  title: {
    color: palette.text,
  },
});
