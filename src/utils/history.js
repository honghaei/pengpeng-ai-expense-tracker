import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'balanceHistory';
const EVENT_KEY = 'transferEvents';

// ---------- Daily snapshots ----------
export async function addBalanceSnapshot(total) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    let hist = raw ? JSON.parse(raw) : [];
    const i = hist.findIndex((h) => h.date === today);
    if (i >= 0) hist[i].total = total;
    else hist.push({ date: today, total });
    if (hist.length > 60) hist = hist.slice(-60);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch {}
}

export async function getBalanceHistory() {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function getAverageBalance(days = 30) {
  const hist = await getBalanceHistory();
  const last = hist.slice(-days);
  if (!last.length) return 0;
  const sum = last.reduce((s, h) => s + (Number(h.total) || 0), 0);
  return sum / last.length;
}

// ---------- Transfer/expense events ----------
export async function appendHistory(event) {
  try {
    const raw = await AsyncStorage.getItem(EVENT_KEY);
    let list = raw ? JSON.parse(raw) : [];
    list.push(event);
    if (list.length > 200) list = list.slice(-200);
    await AsyncStorage.setItem(EVENT_KEY, JSON.stringify(list));
  } catch {}
}

export async function getEventHistory() {
  try {
    const raw = await AsyncStorage.getItem(EVENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
