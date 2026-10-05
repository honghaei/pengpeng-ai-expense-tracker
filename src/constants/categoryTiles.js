// src/constants/categoryTiles.js
export const CATEGORY_TILES = [
  { id: 'food',         title: 'Food & Drink', emoji: '🍽️', color: '#FFE9A8' },
  { id: 'transport',    title: 'Transport',    emoji: '🚌',  color: '#D9ECFF' },
  { id: 'home_bills',   title: 'Home Bills',   emoji: '🔥',  color: '#FAD7D2' },
  { id: 'study',        title: 'Study',        emoji: '🧾',  color: '#E6D8FF' },
  { id: 'family',       title: 'Family',       emoji: '❤️',  color: '#FFD6D9' },
  { id: 'others',       title: 'Others',       emoji: '🪙',  color: '#E1E6EF' },

  // optional extras (not part of Wallet Detail's enforced 6)
  { id: 'groceries',    title: 'Groceries',    emoji: '🧺',  color: '#E8F0B8' },
  { id: 'shopping',     title: 'Shopping',     emoji: '🛍️',  color: '#FFD1EA' },
  { id: 'entertainment',title: 'Entertainment',emoji: '🎬',  color: '#E6DBFF' },
  { id: 'health',       title: 'Health',       emoji: '⚕️',  color: '#FFD6DE' },
  { id: 'education',    title: 'Education',    emoji: '🎓',  color: '#CFE3FF' },
  { id: 'transfers',    title: 'Transfers',    emoji: '↔️',  color: '#FFE5C2' },
  { id: 'misc',         title: 'Misc',         emoji: '💸',  color: '#E1E6EF' },
];

export const CATEGORY_NAMES = CATEGORY_TILES.map(t => t.title);

export function getCategoryMeta(name) {
  const m = CATEGORY_TILES.find(t => t.title === name);
  if (m) return m;
  return { title: name || 'Expense', emoji: '💸', color: '#E1E6EF' };
}
