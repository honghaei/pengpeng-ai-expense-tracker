// src/utils/walletDefaults.js
import { getData, saveData } from './storage';

export const DEFAULT_WALLETS = [
  { id: 'w-food',       name: 'Food & Drink', emoji: '🍽️', color: '#FFE9A8' },
  { id: 'w-transport',  name: 'Transport',    emoji: '🚌',  color: '#CFE4FF' },
  { id: 'w-utilities',  name: 'Utilities',    emoji: '🧾',  color: '#FFDCC9' },
  { id: 'w-leisure',    name: 'Leisure',      emoji: '📝',  color: '#E9D7FF' },
  { id: 'w-health',     name: 'Healthcare',   emoji: '❤️',  color: '#FFD7DA' },
  { id: 'w-others',     name: 'Others',       emoji: '🪙',  color: '#E7EAF3', locked: true },
];

/**
 * Ensure the 6 default wallets exist.
 * - If a default wallet is missing, create it.
 * - Never removes user wallets.
 * - New wallets start at balance 0, empty expenses.
 */
export async function ensureDefaultWallets() {
  const wallets = (await getData('wallets')) || [];
  const byId = Object.fromEntries(wallets.map(w => [w.id, w]));

  let changed = false;
  for (const d of DEFAULT_WALLETS) {
    if (!byId[d.id]) {
      wallets.push({
        id: d.id,
        name: d.name,
        emoji: d.emoji,
        color: d.color,
        balance: 0,
        expenses: [],
        // optional: monthlyCap may be set via WalletScreen cap editor (budgets utils handle caps)
      });
      changed = true;
    }
  }
  if (changed) await saveData('wallets', wallets);
  return wallets;
}
