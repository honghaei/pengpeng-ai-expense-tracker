// src/screens/WalletScreen.js
import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, Alert, StyleSheet, TouchableOpacity, TextInput, Modal,
  ScrollView, KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard, Platform,
} from 'react-native';

import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useFocusEffect } from '@react-navigation/native';
import { getData, saveData } from '../utils/storage';

// wallet defaults (same 6 used on HomeScreen)
import { ensureDefaultWallets, DEFAULT_WALLETS } from '../utils/walletDefaults';

// ledger helpers
import {
  transferFromTotalToWallet,
  transferFromWalletToTotal,
  transferBetweenWallets,
  adjustTotalBalance,
  getTotalBalance,
} from '../utils/ledger';

// Auto Split (percent-based)
import { loadAutoSplit, saveAutoSplit, maybeRunAutoSplitToday } from '../utils/autoSplit';

// Budgets (caps + this-month usage)
import { getBudgets, saveBudgets, THIS_MONTH, monthKey } from '../utils/budgets';
import { normalizeWalletTiles, canonicalizeCategory } from '../utils/categoryTilesGuard';
import { palette, gradients, radius, spacing, shadow, shadowNeutral } from '../theme/design';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

function peso(n) { return `₱${Number(n || 0).toFixed(2)}`; }


// ⏱️ safe local timestamp → "YYYY-MM-DD HH:mm"
const two = (n) => String(n).padStart(2, '0');
const fmtDateTime = (d) => {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d || '');
  return `${dt.getFullYear()}-${two(dt.getMonth() + 1)}-${two(dt.getDate())} ${two(dt.getHours())}:${two(dt.getMinutes())}`;
};

export default function WalletScreen({ navigation }) {
  const [wallets, setWallets] = useState([]);

  // amount modal
  const [amtModal, setAmtModal] = useState({ visible: false, walletId: null, mode: 'deposit', walletName: '' });
  const [amount, setAmount] = useState('');

  // transfer modal
  const [transferModal, setTransferModal] = useState({ visible: false, fromWalletId: null, fromWalletName: '' });
  const [transferTargetId, setTransferTargetId] = useState(null);
  const [transferAmount, setTransferAmount] = useState('');

  // Auto Split
  const [splitModal, setSplitModal] = useState(false);
  const [splitCfg, setSplitCfg] = useState({ allocationsPct: {} });
  const [profileInfo, setProfileInfo] = useState({ monthlyIncome: 0, paydays: 1, days: [] });

  // Edit Cap modal
  const [capModal, setCapModal] = useState({ visible: false, walletId: null, walletName: '' });
  const [capInput, setCapInput] = useState('');

  // ------------------ data ------------------
  const loadWallets = async () => {
    const seeded = await ensureDefaultWallets();

    // keep defaults at the top (fixed order)
    const defaultOrder = DEFAULT_WALLETS.map(d => d.id);
    const defMaps = new Map(seeded.filter(w => defaultOrder.includes(w.id)).map(w => [w.id, w]));
    const others  = seeded.filter(w => !defaultOrder.includes(w.id));
    const ordered = [
      ...defaultOrder.map(id => defMaps.get(id)).filter(Boolean),
      ...others,
    ];

    const bills = (await getData('bills')) || [];
    const budgets = await getBudgets();
    const includeBills = !!budgets.flags?.includeBills;

    const combined = ordered.map((wallet) => {
      // ✅ give related bills a proper description and paid date
      const relatedBills = bills
        .filter((b) => b.walletId === wallet.id && b.paid)
        .map((b) => ({
          id: b.id,
          date: b.paidAt || b.dueDate,
          amount: Number(b.amount || 0),
          description: b.title || 'Bill',
        }));

      const tiles = normalizeWalletTiles(wallet.tiles || []);
      let monthSpent = 0;

      // ✅ Only count true expenses (not transfers, deposits, withdrawals)
      (wallet.expenses || []).forEach((e) => {
        if (!e?.date || monthKey(e.date) !== THIS_MONTH) return;
        const val = Number(e.amount || 0);
        const desc = (e.description || '').toLowerCase();

        if (desc.includes('wallet transfer') || desc.includes('deposit') || desc.includes('withdraw')) {
          return; // skip non-expenses
        }

        if (val < 0) {
          monthSpent += Math.abs(val);
          canonicalizeCategory(e.category || 'Others', tiles);
        }
      });

      if (includeBills) {
        bills
          .filter((b) => b.paid && b.walletId === wallet.id && (b.paidAt || b.dueDate) && monthKey(b.paidAt || b.dueDate) === THIS_MONTH)
          .forEach((b) => {
            monthSpent += Number(b.amount || 0);
            canonicalizeCategory(b.title || 'Home Bills', tiles);
          });
      }

      const cap =
        Number(budgets.byWallet?.[wallet.id]?.walletCap ?? wallet.monthlyCap ?? 0) || null;

      const used = monthSpent;
      const over = cap ? Math.max(0, used - cap) : 0;
      const pct = cap ? Math.round((used / cap) * 100) : 0;

      return {
        ...wallet,
        // 🔧 History list is local to this screen; include description & keep only needed fields
        combinedExpenses: [
          ...(wallet.expenses || []).map(e => ({
            id: e.id,
            date: e.date,
            amount: Number(e.amount || 0),
            description: e.description || e.category || 'Expense',
          })),
          ...relatedBills
        ].sort((a, b) => new Date(b.date) - new Date(a.date)),
        __cap: cap,
        __usedThisMonth: used,
        __overThisMonth: over,
        __pctThisMonth: pct,
      };
    });

    setWallets(combined);

    // load auto-split config and ensure all wallets have an entry
    const cfg = await loadAutoSplit();
    const allocPct = { ...(cfg.allocationsPct || {}) };
    for (const w of combined) if (allocPct[w.id] === undefined) allocPct[w.id] = 0;
    setSplitCfg({ allocationsPct: allocPct });

    // profile summary
    const profile = (await getData('user_profile')) || {};
    const monthlyIncome = Number(profile.monthlyIncome || 0) || 0;
    const days = Array.isArray(profile?.autoIncome?.days) ? profile.autoIncome.days : (
      profile?.autoIncome?.dayOfMonth ? [profile.autoIncome.dayOfMonth] : []
    );
    setProfileInfo({ monthlyIncome, paydays: days.length > 1 ? 2 : 1, days });
  };

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try { await maybeRunAutoSplitToday(); } catch {}
        try { await loadWallets(); } catch {}
      })();
    }, [])
  );

  const goToWalletDetail = (wallet) =>
    navigation.navigate('WalletDetail', { walletId: wallet.id, wallet });

  const goToAddWallet = () => navigation.navigate('AddWallet');

  // ------------------ delete wallet (refund) ------------------
  const isDefaultWallet = (id) => DEFAULT_WALLETS.some(d => d.id === id);

  const confirmRemoveWallet = (walletId, walletName) => {
    if (isDefaultWallet(walletId)) {
      Alert.alert('Default wallet', 'The 6 default wallets cannot be removed.');
      return;
    }
    Alert.alert(
      'Confirm Delete',
      `Remove wallet "${walletName}"? Remaining funds will return to Total Balance.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeWallet(walletId) },
      ]
    );
  };

  const removeWallet = async (walletId) => {
    const toRemove = wallets.find((w) => w.id === walletId);
    const refund = Number(toRemove?.balance || 0);
    if (refund > 0) await adjustTotalBalance(refund);

    const updatedWallets = wallets.filter((w) => w.id !== walletId);
    await saveData('wallets', updatedWallets);
    setWallets(updatedWallets);
    Alert.alert('Wallet Removed', `Returned ${peso(refund)} to Total Balance.`);
  };

  // ------------------ deposit / withdraw ------------------
  const openAmtModal = (walletId, walletName, mode) => {
    setAmtModal({ visible: true, walletId, mode, walletName });
    setAmount('');
  };
  const closeAmtModal = () => {
    setAmtModal({ visible: false, walletId: null, mode: 'deposit', walletName: '' });
    setAmount('');
  };

  const onConfirmAmount = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return Alert.alert('Invalid amount', 'Please enter a positive number.');

    if (amtModal.mode === 'deposit') {
      const res = await transferFromTotalToWallet(amtModal.walletId, amt);
      if (!res.ok) {
        if (res.reason === 'insufficient_total') {
          const t = await getTotalBalance();
          Alert.alert('Not enough Total Balance', `Available: ${peso(t)}`);
        } else Alert.alert('Deposit failed', res.reason || 'Unknown error');
      } else await loadWallets();
    } else {
      const res = await transferFromWalletToTotal(amtModal.walletId, amt);
      if (!res.ok) {
        if (res.reason === 'insufficient_wallet') Alert.alert('Not enough wallet balance', 'Try a smaller amount.');
        else Alert.alert('Withdraw failed', res.reason || 'Unknown error');
      } else await loadWallets();
    }
    closeAmtModal();
  };

  // ------------------ transfer (wallet → wallet) ------------------
  const openTransferModal = (fromWalletId, fromWalletName) => {
    if (wallets.length < 2) return Alert.alert('Need another wallet', 'Create at least two wallets to transfer.');
    setTransferModal({ visible: true, fromWalletId, fromWalletName });
    setTransferTargetId(null);
    setTransferAmount('');
  };
  const closeTransferModal = () => {
    setTransferModal({ visible: false, fromWalletId: null, fromWalletName: '' });
    setTransferTargetId(null);
    setTransferAmount('');
  };
  const onConfirmTransfer = async () => {
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) return Alert.alert('Invalid amount', 'Please enter a positive number.');
    if (!transferTargetId) return Alert.alert('Pick a target', 'Please select a destination wallet.');

    const res = await transferBetweenWallets(transferModal.fromWalletId, transferTargetId, amt);
    if (!res.ok) {
      if (res.reason === 'insufficient_wallet') Alert.alert('Not enough funds', 'Source wallet balance is too low.');
      else if (res.reason === 'same_wallet') Alert.alert('Invalid target', 'Choose a different wallet.');
      else if (res.reason === 'wallet_not_found') Alert.alert('Wallet missing', 'Source or target wallet was not found.');
      else Alert.alert('Transfer failed', res.reason || 'Unknown error');
    } else await loadWallets();

    closeTransferModal();
  };

  // ------------------ edit cap ------------------
  const openCapModal = (walletId, walletName, currentCap) => {
    setCapModal({ visible: true, walletId, walletName });
    setCapInput(currentCap ? String(currentCap) : '');
  };
  const closeCapModal = () => {
    setCapModal({ visible: false, walletId: null, walletName: '' });
    setCapInput('');
  };
  const onSaveCap = async () => {
    const raw = (capInput || '').trim();
    const capNum = raw === '' ? null : Number(raw);
    if (raw !== '' && (!capNum || capNum <= 0)) {
      return Alert.alert('Invalid cap', 'Enter a positive number or leave blank to remove.');
    }

    const budgets = await getBudgets();
    const byWallet = { ...(budgets.byWallet || {}) };
    const prev = byWallet[capModal.walletId] || { byCategory: {} };
    const next = { ...prev, walletCap: capNum };

    if (capNum == null && (!prev.byCategory || Object.keys(prev.byCategory).length === 0)) {
      delete byWallet[capModal.walletId];
    } else {
      byWallet[capModal.walletId] = next;
    }

    await saveBudgets({ ...budgets, byWallet });
    closeCapModal();
    await loadWallets();
    Alert.alert('Saved', capNum == null ? 'Removed wallet cap.' : `Wallet cap set to ${peso(capNum)}.`);
  };

  // ------------------ swipe right actions (Delete only) ------------------
  const renderRightActions = (item) => (
    <View style={styles.rightActions}>
      <TouchableOpacity
        style={[styles.deleteButton, isDefaultWallet(item.id) && { opacity: 0.45 }]}
        onPress={() => confirmRemoveWallet(item.id, item.name)}
        activeOpacity={0.9}
      >
        <Text style={styles.deleteText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  // -------------- Auto Split helpers --------------
  const clearPctIfZero = (walletId) => {
    const current = splitCfg.allocationsPct?.[walletId];
    if (current === 0 || current === '0' || current === undefined) {
      setSplitCfg(s => ({
        ...s,
        allocationsPct: { ...(s.allocationsPct || {}), [walletId]: '' }
      }));
    }
  };

  const setPct = (walletId, text) => {
    const raw = (text || '').replace(/[^0-9.]/g, '');
    const p = Math.max(0, Math.min(100, parseFloat(raw) || 0));

    const map = { ...(splitCfg.allocationsPct || {}) };
    const othersSum = Object.entries(map)
      .filter(([id]) => id !== walletId)
      .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);

    const maxForThis = Math.max(0, 100 - othersSum);
    const clamped = Math.min(p, maxForThis);

    setSplitCfg({ allocationsPct: { ...map, [walletId]: clamped } });
  };

  const saveSplit = async () => {
    const totalPct = Object.values(splitCfg.allocationsPct || {})
      .reduce((s, v) => s + (parseFloat(v) || 0), 0);
    if (totalPct > 100.0001) {
      return Alert.alert('Too high', 'Total percentage cannot exceed 100%.');
    }
    await saveAutoSplit({ allocationsPct: splitCfg.allocationsPct });
    setSplitModal(false);
    Alert.alert('Saved', 'Auto split percentages updated.');
  };

  // These are only used in the UI (don’t pass them as props anywhere!)
  const totalPct = Object.values(splitCfg.allocationsPct || {})
    .reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const remainingPct = Math.max(0, 100 - totalPct);

  // ------------------ row ------------------
  // ------------------ wallet visuals ------------------
  const walletVisual = (name = '') => {
    const key = String(name).toLowerCase();
    if (key.includes('food')) return { icon: 'restaurant-outline', color: '#4FD9FF' };
    if (key.includes('transport')) return { icon: 'car-sport-outline', color: '#6EA8FF' };
    if (key.includes('utilit')) return { icon: 'flash-outline', color: '#7C8CFF' };
    if (key.includes('leisure')) return { icon: 'game-controller-outline', color: '#A98BFF' };
    if (key.includes('health')) return { icon: 'heart-outline', color: '#56D6B3' };
    if (key.includes('saving')) return { icon: 'leaf-outline', color: '#56D6B3' };
    if (key.includes('travel')) return { icon: 'airplane-outline', color: '#6EA8FF' };
    return { icon: 'wallet-outline', color: '#86A5CC' };
  };

  const openAutoSplitModal = async () => {
    const profile = (await getData('user_profile')) || {};
    const monthlyIncome = Number(profile.monthlyIncome || 0) || 0;
    const days = Array.isArray(profile?.autoIncome?.days)
      ? profile.autoIncome.days
      : (profile?.autoIncome?.dayOfMonth ? [profile.autoIncome.dayOfMonth] : []);
    setProfileInfo({ monthlyIncome, paydays: days.length > 1 ? 2 : 1, days });
    setSplitModal(true);
  };

  const totalWalletFunds = wallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  const cappedWallets = wallets.filter((wallet) => !!wallet.__cap).length;

  // ------------------ row ------------------
  const WalletRow = ({ item, index }) => {
    const cap = item.__cap;
    const used = item.__usedThisMonth || 0;
    const over = item.__overThisMonth || 0;
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const visual = walletVisual(item.name);
    const latest = item.combinedExpenses?.[0];

    if (index === 0) {
      return (
        <Swipeable renderRightActions={() => renderRightActions(item)} overshootRight={false}>
          <TouchableOpacity activeOpacity={0.92} onPress={() => goToWalletDetail(item)}>
            <LinearGradient
              colors={gradients.wallet}
              start={{ x: 0.02, y: 0.05 }}
              end={{ x: 1, y: 1 }}
              style={styles.featuredWallet}
            >
              <View style={styles.featuredTopRow}>
                <View style={styles.featuredIdentity}>
                  <View style={styles.featuredIcon}>
                    <Ionicons name={visual.icon} size={21} color="#FFFFFF" />
                  </View>
                  <View>
                    <Text style={styles.featuredEyebrow}>PRIMARY WALLET</Text>
                    <Text style={styles.featuredName}>{item.name}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => openCapModal(item.id, item.name, cap)}
                  style={styles.featuredCapButton}
                  activeOpacity={0.85}
                >
                  <Ionicons name="speedometer-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.featuredCapText}>{cap ? 'Edit cap' : 'Set cap'}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.featuredBalanceLabel}>Available balance</Text>
              <Text style={styles.featuredBalance}>{peso(item.balance)}</Text>

              {!!cap && (
                <View style={styles.featuredBudgetBlock}>
                  <View style={styles.featuredBudgetMeta}>
                    <Text style={styles.featuredBudgetText}>
                      {over > 0 ? `Over cap by ${peso(over)}` : `${peso(used)} of ${peso(cap)} used`}
                    </Text>
                    <Text style={styles.featuredBudgetText}>{pct}%</Text>
                  </View>
                  <View style={styles.featuredProgressTrack}>
                    <View
                      style={[
                        styles.featuredProgressFill,
                        {
                          width: `${Math.min(100, pct)}%`,
                          backgroundColor: over > 0 ? palette.danger : '#79E6FF',
                        },
                      ]}
                    />
                  </View>
                </View>
              )}

              <View style={styles.featuredActions}>
                <WalletAction
                  icon="arrow-down-outline"
                  label="Deposit"
                  onPress={() => openAmtModal(item.id, item.name, 'deposit')}
                  featured
                />
                <WalletAction
                  icon="arrow-up-outline"
                  label="Withdraw"
                  onPress={() => openAmtModal(item.id, item.name, 'withdraw')}
                  featured
                />
                <WalletAction
                  icon="swap-horizontal-outline"
                  label="Transfer"
                  onPress={() => openTransferModal(item.id, item.name)}
                  featured
                />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </Swipeable>
      );
    }

    return (
      <Swipeable renderRightActions={() => renderRightActions(item)} overshootRight={false}>
        <View style={styles.walletListItem}>
          <TouchableOpacity
            activeOpacity={0.78}
            onPress={() => goToWalletDetail(item)}
            style={styles.walletMainRow}
          >
            <View style={[styles.walletIcon, { borderColor: `${visual.color}55`, backgroundColor: `${visual.color}12` }]}>
              <Ionicons name={visual.icon} size={21} color={visual.color} />
            </View>

            <View style={styles.walletInfo}>
              <View style={styles.walletNameLine}>
                <Text style={styles.walletName} numberOfLines={1}>{item.name}</Text>
                {!!cap && <Text style={styles.capPill}>{pct}% of cap</Text>}
              </View>
              <Text style={styles.walletMeta} numberOfLines={1}>
                {cap
                  ? `${peso(used)} spent this month · cap ${peso(cap)}`
                  : latest
                    ? `Last activity · ${fmtDateTime(latest.date)}`
                    : 'No monthly cap set'}
              </Text>
            </View>

            <View style={styles.walletAmountWrap}>
              <Text style={styles.walletBalance}>{peso(item.balance)}</Text>
              <Ionicons name="chevron-forward" size={17} color={palette.muted} />
            </View>
          </TouchableOpacity>

          {!!cap && (
            <View style={styles.listProgressTrack}>
              <View
                style={[
                  styles.listProgressFill,
                  {
                    width: `${Math.min(100, pct)}%`,
                    backgroundColor: over > 0 ? palette.danger : visual.color,
                  },
                ]}
              />
            </View>
          )}

          <View style={styles.inlineActions}>
            <WalletAction
              icon="arrow-down-outline"
              label="Deposit"
              onPress={() => openAmtModal(item.id, item.name, 'deposit')}
            />
            <WalletAction
              icon="arrow-up-outline"
              label="Withdraw"
              onPress={() => openAmtModal(item.id, item.name, 'withdraw')}
            />
            <WalletAction
              icon="swap-horizontal-outline"
              label="Transfer"
              onPress={() => openTransferModal(item.id, item.name)}
            />
            <WalletAction
              icon="speedometer-outline"
              label={cap ? 'Cap' : 'Set cap'}
              onPress={() => openCapModal(item.id, item.name, cap)}
            />
          </View>
        </View>
      </Swipeable>
    );
  };

  // ------------------ render ------------------
  return (
    <View style={styles.container}>
      <FlatList
        data={wallets}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <WalletRow item={item} index={index} />}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        ListHeaderComponent={(
          <View style={styles.pageIntro}>
            <View style={styles.introTopRow}>
              <View style={styles.introCopy}>
                <Text style={styles.eyebrow}>ACCOUNTS & BUDGETS</Text>
                <Text style={styles.title}>Money, organized.</Text>
                <Text style={styles.subtitle}>
                  Move funds, set limits, and keep each spending bucket easy to understand.
                </Text>
              </View>

              <View style={styles.headerActions}>
                <TouchableOpacity onPress={openAutoSplitModal} style={styles.headerIconButton} activeOpacity={0.85}>
                  <Ionicons name="git-compare-outline" size={20} color={palette.cyan} />
                </TouchableOpacity>
                <TouchableOpacity onPress={goToAddWallet} activeOpacity={0.88}>
                  <LinearGradient colors={gradients.primary} style={styles.headerAddButton}>
                    <Ionicons name="add" size={23} color="#FFFFFF" />
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.summaryStrip}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Across wallets</Text>
                <Text style={styles.summaryValue}>{peso(totalWalletFunds)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItemSmall}>
                <Text style={styles.summaryLabel}>Wallets</Text>
                <Text style={styles.summaryValueSmall}>{wallets.length}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItemSmall}>
                <Text style={styles.summaryLabel}>With caps</Text>
                <Text style={styles.summaryValueSmall}>{cappedWallets}</Text>
              </View>
            </View>

            {wallets.length > 0 && (
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>Your wallets</Text>
                <Text style={styles.sectionHint}>Swipe custom wallets to delete</Text>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="wallet-outline" size={28} color={palette.cyan} />
            </View>
            <Text style={styles.emptyTitle}>No wallets yet</Text>
            <Text style={styles.emptyText}>Create your first wallet to organize spending and monthly limits.</Text>
            <TouchableOpacity onPress={goToAddWallet} activeOpacity={0.9}>
              <LinearGradient colors={gradients.primary} style={styles.emptyButton}>
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.emptyButtonText}>Create wallet</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />

      {/* Amount sheet */}
      <Modal transparent visible={amtModal.visible} animationType="slide" onRequestClose={closeAmtModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetEyebrow}>{amtModal.mode === 'deposit' ? 'ADD FUNDS' : 'MOVE TO TOTAL BALANCE'}</Text>
              <Text style={styles.modalTitle}>
                {amtModal.mode === 'deposit' ? 'Deposit to' : 'Withdraw from'} {amtModal.walletName}
              </Text>
              <Text style={styles.sheetDescription}>Enter the amount you want to move.</Text>

              <View style={styles.moneyInputWrap}>
                <Text style={styles.currencyMark}>₱</Text>
                <TextInput
                  placeholder="0.00"
                  placeholderTextColor={palette.muted}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                  returnKeyType="done"
                  onSubmitEditing={onConfirmAmount}
                  style={styles.moneyInput}
                />
              </View>

              <View style={styles.sheetButtons}>
                <TouchableOpacity onPress={closeAmtModal} style={styles.secondarySheetButton}>
                  <Text style={styles.secondarySheetButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onConfirmAmount} style={styles.primarySheetButtonWrap}>
                  <LinearGradient colors={gradients.primary} style={styles.primarySheetButton}>
                    <Text style={styles.primarySheetButtonText}>Confirm</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Transfer sheet */}
      <Modal transparent visible={transferModal.visible} animationType="slide" onRequestClose={closeTransferModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetEyebrow}>TRANSFER MONEY</Text>
              <Text style={styles.modalTitle}>From {transferModal.fromWalletName}</Text>
              <Text style={styles.sheetDescription}>Choose a destination wallet and amount.</Text>

              <ScrollView style={styles.targetList} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {wallets
                  .filter((w) => w.id !== transferModal.fromWalletId)
                  .map((w) => {
                    const visual = walletVisual(w.name);
                    const selected = transferTargetId === w.id;
                    return (
                      <TouchableOpacity
                        key={w.id}
                        style={[styles.targetItem, selected && styles.targetItemSelected]}
                        onPress={() => setTransferTargetId(w.id)}
                      >
                        <View style={[styles.targetIcon, { backgroundColor: `${visual.color}15` }]}>
                          <Ionicons name={visual.icon} size={18} color={visual.color} />
                        </View>
                        <Text style={styles.targetText} numberOfLines={1}>{w.name}</Text>
                        <Text style={styles.targetTextSmall}>{peso(w.balance)}</Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>

              <View style={styles.moneyInputWrap}>
                <Text style={styles.currencyMark}>₱</Text>
                <TextInput
                  placeholder="0.00"
                  placeholderTextColor={palette.muted}
                  keyboardType="decimal-pad"
                  value={transferAmount}
                  onChangeText={setTransferAmount}
                  returnKeyType="done"
                  onSubmitEditing={onConfirmTransfer}
                  style={styles.moneyInput}
                />
              </View>

              <View style={styles.sheetButtons}>
                <TouchableOpacity onPress={closeTransferModal} style={styles.secondarySheetButton}>
                  <Text style={styles.secondarySheetButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onConfirmTransfer} style={styles.primarySheetButtonWrap}>
                  <LinearGradient colors={gradients.primary} style={styles.primarySheetButton}>
                    <Text style={styles.primarySheetButtonText}>Transfer</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Auto Split sheet */}
      <Modal transparent visible={splitModal} animationType="slide" onRequestClose={() => setSplitModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.sheetCardTall}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetEyebrow}>AUTOMATION</Text>
              <Text style={styles.modalTitle}>Auto split income</Text>
              <Text style={styles.sheetDescription}>
                Assign a percentage to each wallet. Splits run automatically on your payday{profileInfo.paydays === 2 ? 's' : ''}.
              </Text>

              <View style={styles.incomeSummary}>
                <View>
                  <Text style={styles.summaryLabel}>Monthly income</Text>
                  <Text style={styles.incomeValue}>{peso(profileInfo.monthlyIncome)}</Text>
                </View>
                <View style={styles.incomeMetaRight}>
                  <Text style={styles.summaryLabel}>Paydays</Text>
                  <Text style={styles.incomePaydays}>{profileInfo.paydays}</Text>
                </View>
              </View>

              <ScrollView style={styles.splitList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {wallets.map((w) => {
                  const val = splitCfg.allocationsPct?.[w.id];
                  const valueStr = val === '' ? '' : String(val ?? 0);
                  const visual = walletVisual(w.name);
                  return (
                    <View key={w.id} style={styles.splitRow}>
                      <View style={[styles.splitIcon, { backgroundColor: `${visual.color}12` }]}>
                        <Ionicons name={visual.icon} size={17} color={visual.color} />
                      </View>
                      <Text style={styles.splitName}>{w.name}</Text>
                      <TextInput
                        style={styles.percentInput}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={palette.muted}
                        value={valueStr}
                        onFocus={() => clearPctIfZero(w.id)}
                        onChangeText={(t) => setPct(w.id, t)}
                        selectTextOnFocus
                      />
                      <Text style={styles.percentSign}>%</Text>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.splitFooter}>
                <Text style={[styles.splitTotal, totalPct > 100 && { color: palette.danger }]}>Allocated {totalPct.toFixed(1)}%</Text>
                <Text style={styles.splitRemaining}>{remainingPct.toFixed(1)}% remaining</Text>
              </View>

              <View style={styles.sheetButtons}>
                <TouchableOpacity onPress={() => setSplitModal(false)} style={styles.secondarySheetButton}>
                  <Text style={styles.secondarySheetButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveSplit} style={styles.primarySheetButtonWrap}>
                  <LinearGradient colors={gradients.primary} style={styles.primarySheetButton}>
                    <Text style={styles.primarySheetButtonText}>Save split</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Cap sheet */}
      <Modal transparent visible={capModal.visible} animationType="slide" onRequestClose={closeCapModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.overlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.sheetCard}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetEyebrow}>MONTHLY LIMIT</Text>
              <Text style={styles.modalTitle}>Set cap for {capModal.walletName}</Text>
              <Text style={styles.sheetDescription}>Leave it blank if you want to remove the monthly cap.</Text>

              <View style={styles.moneyInputWrap}>
                <Text style={styles.currencyMark}>₱</Text>
                <TextInput
                  placeholder="5,000"
                  placeholderTextColor={palette.muted}
                  keyboardType="decimal-pad"
                  value={capInput}
                  onChangeText={setCapInput}
                  style={styles.moneyInput}
                  returnKeyType="done"
                  onSubmitEditing={onSaveCap}
                />
              </View>

              <View style={styles.sheetButtons}>
                <TouchableOpacity onPress={closeCapModal} style={styles.secondarySheetButton}>
                  <Text style={styles.secondarySheetButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onSaveCap} style={styles.primarySheetButtonWrap}>
                  <LinearGradient colors={gradients.primary} style={styles.primarySheetButton}>
                    <Text style={styles.primarySheetButtonText}>Save cap</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function WalletAction({ icon, label, onPress, featured = false }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.78}
      style={[styles.walletAction, featured && styles.walletActionFeatured]}
    >
      <View style={[styles.walletActionIcon, featured && styles.walletActionIconFeatured]}>
        <Ionicons name={icon} size={16} color={featured ? '#FFFFFF' : palette.cyan} />
      </View>
      <Text style={[styles.walletActionText, featured && styles.walletActionTextFeatured]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  listContent: {
    paddingHorizontal: spacing.l,
    paddingTop: 10,
    paddingBottom: 118,
  },

  // Intro
  pageIntro: {
    paddingBottom: 14,
  },
  introTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  introCopy: {
    flex: 1,
  },
  eyebrow: {
    color: palette.cyan,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  title: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '900',
    color: palette.text,
    letterSpacing: -0.65,
  },
  subtitle: {
    color: palette.sub,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
    maxWidth: 520,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 2,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.hairline,
    backgroundColor: palette.bgSoft,
  },
  headerAddButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow(9, 0.24),
  },
  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
  },
  summaryItem: {
    flex: 1.5,
  },
  summaryItemSmall: {
    flex: 0.65,
    paddingLeft: 16,
  },
  summaryLabel: {
    color: palette.sub,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
    letterSpacing: -0.5,
  },
  summaryValueSmall: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4,
  },
  summaryDivider: {
    width: 1,
    height: 34,
    backgroundColor: palette.hairline,
    marginLeft: 14,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '850',
  },
  sectionHint: {
    color: palette.muted,
    fontSize: 10,
  },

  // Featured wallet
  featuredWallet: {
    borderRadius: radius.xxl,
    padding: 20,
    marginBottom: 14,
    minHeight: 230,
    borderWidth: 1,
    borderColor: 'rgba(121,230,255,0.28)',
    ...shadow(14, 0.3),
  },
  featuredTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  featuredIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
  },
  featuredIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.17)',
  },
  featuredEyebrow: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  featuredName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  featuredCapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(4,18,52,0.24)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  featuredCapText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  featuredBalanceLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 24,
  },
  featuredBalance: {
    color: '#FFFFFF',
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '900',
    letterSpacing: -1.1,
    marginTop: 2,
  },
  featuredBudgetBlock: {
    marginTop: 13,
  },
  featuredBudgetMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  featuredBudgetText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 10,
    fontWeight: '700',
  },
  featuredProgressTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(4,18,52,0.30)',
    overflow: 'hidden',
    marginTop: 7,
  },
  featuredProgressFill: {
    height: 5,
    borderRadius: 999,
  },
  featuredActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: 20,
  },

  // Wallet rows
  walletListItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },
  walletMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  walletIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletInfo: {
    flex: 1,
    minWidth: 0,
  },
  walletNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  walletName: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '850',
    flexShrink: 1,
  },
  capPill: {
    color: palette.cyan,
    backgroundColor: palette.cyanSoft,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 8,
    fontWeight: '900',
  },
  walletMeta: {
    color: palette.sub,
    fontSize: 10,
    marginTop: 4,
  },
  walletAmountWrap: {
    alignItems: 'flex-end',
    gap: 3,
  },
  walletBalance: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '900',
  },
  listProgressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: palette.surface2,
    overflow: 'hidden',
    marginLeft: 56,
    marginTop: 10,
  },
  listProgressFill: {
    height: 4,
    borderRadius: 999,
  },
  inlineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginLeft: 56,
    marginTop: 11,
  },
  walletAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  walletActionFeatured: {
    flex: 1,
  },
  walletActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cyanSoft,
  },
  walletActionIconFeatured: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  walletActionText: {
    color: palette.sub,
    fontSize: 9,
    fontWeight: '700',
  },
  walletActionTextFeatured: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  // Swipe delete
  rightActions: {
    width: 94,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    backgroundColor: palette.danger,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  deleteText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    paddingTop: 72,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: 19,
    fontWeight: '900',
    marginTop: 16,
  },
  emptyText: {
    color: palette.sub,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    maxWidth: 290,
  },
  emptyButton: {
    marginTop: 18,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    ...shadow(8, 0.2),
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '850',
  },

  // Bottom sheets
  overlay: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: palette.cardStrong,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: palette.borderStrong,
    ...shadowNeutral(18, 0.42),
  },
  sheetCardTall: {
    backgroundColor: palette.cardStrong,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 30 : 22,
    maxHeight: '82%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: palette.borderStrong,
    ...shadowNeutral(18, 0.42),
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: palette.borderStrong,
    alignSelf: 'center',
    marginBottom: 18,
  },
  sheetEyebrow: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.25,
    marginBottom: 6,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  sheetDescription: {
    color: palette.sub,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  moneyInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
    paddingBottom: 8,
  },
  currencyMark: {
    color: palette.cyan,
    fontSize: 28,
    fontWeight: '900',
    marginRight: 8,
  },
  moneyInput: {
    flex: 1,
    color: palette.text,
    fontSize: 28,
    fontWeight: '800',
    paddingVertical: 4,
  },
  sheetButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  secondarySheetButton: {
    flex: 0.8,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface2,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  secondarySheetButtonText: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  primarySheetButtonWrap: {
    flex: 1.2,
  },
  primarySheetButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySheetButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },

  // Transfer destination cards
  targetList: {
    marginTop: 18,
    maxHeight: 114,
  },
  targetItem: {
    width: 118,
    padding: 12,
    borderRadius: 18,
    marginRight: 9,
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  targetItemSelected: {
    borderColor: palette.cyan,
    backgroundColor: palette.cyanSoft,
  },
  targetIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetText: {
    color: palette.text,
    fontWeight: '800',
    fontSize: 11,
    marginTop: 8,
  },
  targetTextSmall: {
    color: palette.sub,
    fontSize: 9,
    marginTop: 3,
  },

  // Auto split
  incomeSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: 16,
    marginTop: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.hairline,
  },
  incomeMetaRight: {
    alignItems: 'flex-end',
  },
  incomeValue: {
    color: palette.text,
    fontSize: 21,
    fontWeight: '900',
    marginTop: 3,
  },
  incomePaydays: {
    color: palette.text,
    fontSize: 21,
    fontWeight: '900',
    marginTop: 3,
  },
  splitList: {
    marginTop: 12,
  },
  splitRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },
  splitIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  splitName: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  percentInput: {
    width: 62,
    color: palette.text,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'right',
    paddingVertical: 6,
  },
  percentSign: {
    color: palette.sub,
    marginLeft: 4,
  },
  splitFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  splitTotal: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: '900',
  },
  splitRemaining: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
  },
});
