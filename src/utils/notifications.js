// src/utils/notifications.js
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getData } from './storage';
import { getTotalBalance } from './ledger';

/**
 * Expo SDK 53+: Expo Go on Android no longer supports remote push tokens.
 * Also, importing 'expo-notifications' in Expo Go can internally register
 * listeners that trigger a console error. To avoid that, we only require()
 * the module in environments that support it. Otherwise we provide no-op shims.
 */
const isExpoGo = Constants.appOwnership === 'expo';
const isAndroid = Platform.OS === 'android';

let Notifications;

/** load real module only when NOT Expo Go on Android */
if (!(isExpoGo && isAndroid)) {
  // Lazy require avoids module side effects in Expo Go Android.
  Notifications = require('expo-notifications');

  // Foreground handler (safe in dev/prod builds)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} else {
  // ---- Minimal shims so the rest of the app can call these safely in Expo Go ----
  Notifications = {
    // perms: pretend granted so local flows can continue (no remote tokens involved)
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    // local notification helpers (no-ops in Expo Go Android)
    presentNotificationAsync: async () => {},
    scheduleNotificationAsync: async () => {},
    cancelScheduledNotificationAsync: async () => {},
    cancelAllScheduledNotificationsAsync: async () => {},
    getAllScheduledNotificationsAsync: async () => [],
    setNotificationHandler: () => {},
  };

  // Let devs know why remote push is disabled here (once).
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[notifications] Remote push APIs are disabled in Expo Go on Android (SDK 53+). ' +
      'Use a development build to test push. Local notification shims are active.'
    );
  }
}

/* --------------------------- small helper --------------------------- */
async function ensurePerms() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function fireBudgetNotification({ title, body }) {
  try {
    if (!(await ensurePerms())) return;
    await Notifications.presentNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch { /* swallow */ }
}

/* =======================
 *  Monthly report reminder
 *  ======================= */
export async function ensureMonthlyReportReminder() {
  if (!(await ensurePerms())) return;

  // avoid duplicates
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) {
    if (n.identifier?.startsWith?.('monthly-report-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  await Notifications.scheduleNotificationAsync({
    identifier: `monthly-report-${Date.now()}`,
    content: {
      title: 'Monthly report',
      body: 'New month! Open the app to generate your expense report.',
    },
    trigger: { day: 1, hour: 9, minute: 0, repeats: true },
  });
}

/* =======================
 *     Payday reminders
 *  ======================= */
export async function ensurePaydayReminders(days = []) {
  if (!(await ensurePerms())) return;

  // Clear previous payday notices
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) {
    if (n.identifier?.startsWith?.('payday-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const ds = (Array.isArray(days) ? days : [days]).map((d) => Number(d)).filter(Boolean);
  for (const day of ds) {
    // On the day @ 9:00
    await Notifications.scheduleNotificationAsync({
      identifier: `payday-on-${day}`,
      content: { title: 'Payday', body: 'Income recorded today. Open the app to review.' },
      trigger: { day, hour: 9, minute: 0, repeats: true },
    });

    // 1 day before @ 9:00 (approx; if day=1, use 28 to simulate “last day”)
    const prev = day === 1 ? 28 : day - 1;
    await Notifications.scheduleNotificationAsync({
      identifier: `payday-prev-${day}`,
      content: { title: 'Payday tomorrow', body: 'We will add your income automatically tomorrow.' },
      trigger: { day: prev, hour: 9, minute: 0, repeats: true },
    });
  }
}

export async function cancelPaydayReminders() {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) {
    if (n.identifier?.startsWith?.('payday-')) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

/* =======================
 *        Bills
 *  ======================= */
export async function scheduleBillNotifications(bill) {
  if (!bill?.id || !bill?.dueDate) return;
  if (!(await ensurePerms())) return;

  await cancelBillNotifications(bill.id); // clear any previous entries

  const due = new Date(bill.dueDate);
  if (isNaN(due)) return;

  const mkD = (base, deltaDays) => {
    const d = new Date(base);
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() + deltaDays);
    return d;
  };

  const minus3 = mkD(due, -3);
  const minus1 = mkD(due, -1);
  const onDay  = mkD(due, 0);
  const plus1  = mkD(due, +1);

  const items = [
    { id: 'pre3',  date: minus3, title: 'Upcoming bill',     body: `${bill.title || 'Bill'} is due in 3 days.` },
    { id: 'pre1',  date: minus1, title: 'Bill due tomorrow', body: `${bill.title || 'Bill'} is due tomorrow.` },
    { id: 'day0',  date: onDay,  title: 'Bill due today',    body: `${bill.title || 'Bill'} is due today.` },
    { id: 'post1', date: plus1,  title: 'Bill overdue',      body: `${bill.title || 'Bill'} was due yesterday.` },
  ];

  for (const it of items) {
    await Notifications.scheduleNotificationAsync({
      identifier: `bill-${bill.id}-${it.id}`,
      content: { title: it.title, body: it.body },
      trigger: it.date,
    });
  }
}

export async function cancelBillNotifications(billId) {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) {
    if (n.identifier?.startsWith?.(`bill-${billId}-`)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

export async function rescheduleAllBills() {
  const bills = (await getData('bills')) || [];
  for (const b of bills) {
    if (!b.paid) await scheduleBillNotifications(b);
    else await cancelBillNotifications(b.id);
  }
}

/* =======================
 *   Low balance (daily)
 *  ======================= */
export async function lowBalanceGuard() {
  try {
    const profile = (await getData('user_profile')) || {};
    const pct = Number(profile?.alerts?.lowBalancePct ?? 0);
    const income = Number(profile?.monthlyIncome ?? 0);

    if (!pct || pct <= 0 || !income || income <= 0) return;

    const threshold = income * (pct / 100);
    const total = Number(await getTotalBalance());

    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const raw = await AsyncStorage.getItem('low_balance_alert_state');
    const state = raw ? JSON.parse(raw) : { date: null, below: false };

    if (total < threshold) {
      if (state.date !== ymd) {
        await fireBudgetNotification({
          title: 'Low balance alert',
          body: `Your total balance (₱${total.toLocaleString()}) is below ${pct}% of your monthly income (≈ ₱${Math.round(threshold).toLocaleString()}).`,
        });
        await AsyncStorage.setItem('low_balance_alert_state', JSON.stringify({ date: ymd, below: true }));
      }
    } else {
      if (state.below || state.date) {
        await AsyncStorage.setItem('low_balance_alert_state', JSON.stringify({ date: null, below: false }));
      }
    }
  } catch { /* ignore */ }
}

/* =======================
 *  Daily sweep entrypoint
 *  ======================= */
export async function runDailyBudgetSweep() {
  await lowBalanceGuard();
}

/** Placeholder so your code that calls this doesn't break */
export async function scheduleBudgetSweep() {
  // Intentionally empty – call runDailyBudgetSweep() when the app opens/foregrounds.
}

// Aliases kept for compatibility
export {
  scheduleBillNotifications as schedulePayableNotifications,
  cancelBillNotifications as cancelPayableNotifications,
};
