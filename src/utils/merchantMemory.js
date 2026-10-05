// src/utils/merchantMemory.js
import { getData, saveData } from './storage';

const KEY = 'merchant_memory_v1';
const MAX_PER_MERCHANT = 10;

function tokenize(s = '') {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export async function rememberMerchant({ description = '', walletId = null, category = 'Others' }) {
  const mem = (await getData(KEY)) || {};
  const tokens = tokenize(description);
  if (tokens.length === 0) return;

  const key = tokens[0]; // simplest anchor on first word
  const entry = mem[key] || { seen: 0, wallets: {}, categories: {} };
  entry.seen += 1;
  if (walletId) entry.wallets[walletId] = (entry.wallets[walletId] || 0) + 1;
  if (category) entry.categories[category] = (entry.categories[category] || 0) + 1;

  // prune to avoid bloat
  const topK = (obj) =>
    Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0, MAX_PER_MERCHANT)
      .reduce((acc,[k,v]) => (acc[k]=v, acc), {});
  entry.wallets = topK(entry.wallets);
  entry.categories = topK(entry.categories);

  mem[key] = entry;
  await saveData(KEY, mem);
}

export async function suggestWallet(description = '') {
  const mem = (await getData(KEY)) || {};
  const tokens = tokenize(description);
  if (!tokens.length) return null;
  const entry = mem[tokens[0]];
  if (!entry) return null;
  const [walletId] = Object.entries(entry.wallets).sort((a,b)=>b[1]-a[1])[0] || [];
  return walletId || null;
}

export async function suggestCategory(description = '') {
  const mem = (await getData(KEY)) || {};
  const tokens = tokenize(description);
  if (!tokens.length) return null;
  const entry = mem[tokens[0]];
  if (!entry) return null;
  const [cat] = Object.entries(entry.categories).sort((a,b)=>b[1]-a[1])[0] || [];
  return cat || null;
}
