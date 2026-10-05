// src/utils/quickExpense.js
import { getData, saveData } from './storage';
import { getTotalBalance, adjustTotalBalance } from './ledger';
import { normalizeWalletTiles, canonicalizeCategory } from './categoryTilesGuard';
import { ingestTransaction } from './rag';
import { rememberMerchant } from './merchantMemory';

function isoNow() { try { return new Date().toISOString(); } catch { return String(Date.now()); } }
function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

/**
 * @param {{source:'wallet'|'total', walletId?:string|null, amount:number|string, description?:string, category?:string}} payload
 */
export async function addQuickExpense(payload = {}) {
  const source = payload.source === 'total' ? 'total' : 'wallet';
  const rawAmt = Number(payload.amount);
  if (!Number.isFinite(rawAmt) || rawAmt <= 0) return { ok: false, reason: 'invalid_amount' };
  const description = (payload.description || '').trim();
  const requestedCategory = (payload.category || 'Others').trim() || 'Others';

  if (source === 'wallet') {
    const walletId = payload.walletId;
    if (!walletId) return { ok: false, reason: 'no_wallet' };

    const wallets = (await getData('wallets')) || [];
    const idx = wallets.findIndex(w => w.id === walletId);
    if (idx === -1) return { ok: false, reason: 'wallet_not_found' };

    const wallet = wallets[idx];
    const balance = Number(wallet.balance || 0);
    if (rawAmt > balance) return { ok: false, reason: 'insufficient_wallet' };

    const normalizedTiles = normalizeWalletTiles(wallet.tiles || []);
    const safeCategory = canonicalizeCategory(requestedCategory, normalizedTiles);

    const expense = {
      id: makeId(),
      category: safeCategory,
      amount: rawAmt,
      date: isoNow(),
      source: 'Wallet',
      description,
    };

    const updatedWallet = {
      ...wallet,
      balance: balance - rawAmt,
      tiles: normalizedTiles,
      expenses: [...(wallet.expenses || []), expense],
    };

    const next = wallets.slice();
    next[idx] = updatedWallet;
    await saveData('wallets', next);

    // ✅ learn it (RAG + symbolic memory)
    await ingestTransaction({
      ...expense,
      walletId,
      walletName: wallet.name,
    });
    await rememberMerchant({ description, walletId, category: safeCategory });

    return { ok: true, wallet: updatedWallet, expense };
  }

  // Deduct from TOTAL balance (does not touch wallet tiles)
  if (source === 'total') {
    const total = Number(await getTotalBalance()) || 0;
    if (rawAmt > total) return { ok: false, reason: 'insufficient_total' };
    await adjustTotalBalance(-rawAmt);

    const txn = {
      id: makeId(),
      type: 'TOTAL_EXPENSE_DEBIT',
      amount: rawAmt,
      note: description || requestedCategory,
      category: requestedCategory,
      date: isoNow(),
      source: 'Total',
    };

    const ledger = (await getData('ledger')) || [];
    ledger.push(txn);
    await saveData('ledger', ledger);

    // learn this too (walletId null)
    await ingestTransaction({
      description,
      category: requestedCategory,
      amount: rawAmt,
      date: txn.date,
      source: 'Total',
      walletId: null,
      walletName: 'Total Balance',
    });
    await rememberMerchant({ description, walletId: null, category: requestedCategory });

    return { ok: true };
  }

  return { ok: false, reason: 'unknown_source' };
}
