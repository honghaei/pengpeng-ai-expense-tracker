// src/utils/categoryTilesGuard.js
export const OTHERS_TILE = Object.freeze({
  id: 'others',
  title: 'Others',
  emoji: '🪙',
  color: '#E1E6EF',
  locked: true,
});

const DEFAULT_FIVE = [
  { id: 'food',       title: 'Food & Drink', emoji: '🍽️', color: '#FFE9A8' },
  { id: 'transport',  title: 'Transport',    emoji: '🚌',  color: '#D9ECFF' },
  { id: 'home_bills', title: 'Home Bills',   emoji: '🔥',  color: '#FAD7D2' },
  { id: 'study',      title: 'Study',        emoji: '🧾',  color: '#E6D8FF' },
  { id: 'family',     title: 'Family',       emoji: '❤️',  color: '#FFD6D9' },
];

/** Always return 6 tiles, with the 6th locked to Others */
export function normalizeWalletTiles(inputTiles) {
  const src = Array.isArray(inputTiles) ? inputTiles.slice(0, 5) : [];
  const firstFive = Array.from({ length: 5 }, (_, i) => {
    const t = src[i];
    return t && t.title ? t : DEFAULT_FIVE[i];
  });
  return [...firstFive, { ...OTHERS_TILE }];
}

/** If category not in the first 5 tile titles, return Others */
export function canonicalizeCategory(category, tiles) {
  const set = new Set((tiles || []).slice(0, 5).map(t => t.title));
  return set.has(category) ? category : OTHERS_TILE.title;
}

/** Bucket expenses by category into the 6 UI tiles (Others catches non-matches) */
export function bucketByTiles(expenses = [], tiles = []) {
  const normalized = normalizeWalletTiles(tiles);
  const firstFive = normalized.slice(0, 5).map(t => t.title);
  const allKeys = [...firstFive, OTHERS_TILE.title];
  const buckets = Object.fromEntries(allKeys.map(k => [k, 0]));

  let grand = 0;
  for (const e of expenses) {
    const amt = Number(e?.amount || 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const cat = (e?.category || '').trim();
    const key = firstFive.includes(cat) ? cat : OTHERS_TILE.title;
    buckets[key] += amt;
    grand += amt;
  }

  const list = allKeys.map(title => ({ title, total: buckets[title] }));
  return { buckets, list, total: grand };
}
