// src/screens/WalletDetailScreen.js
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { getData, saveData } from '../utils/storage';
import {
  palette,
  gradients,
  radius,
  spacing,
  shadow,
} from '../theme/design';

const twoDigits = (n) => (n < 10 ? `0${n}` : `${n}`);

const nowStamp = () => {
  const d = new Date();

  return `${d.getFullYear()}-${twoDigits(
    d.getMonth() + 1
  )}-${twoDigits(d.getDate())} ${twoDigits(
    d.getHours()
  )}:${twoDigits(d.getMinutes())}`;
};

const peso2 = (n) =>
  `₱${Math.abs(Number(n || 0)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const parseDateSafe = (input) => {
  if (!input) return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  const raw = String(input);
  const direct = new Date(raw);

  if (!Number.isNaN(direct.getTime())) return direct;

  const isoLike = new Date(raw.replace(' ', 'T'));
  return Number.isNaN(isoLike.getTime()) ? null : isoLike;
};

const friendlyDateTime = (input) => {
  const d = parseDateSafe(input);

  if (!d) return String(input || '');

  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const isNonExpenseMovement = (desc = '') => {
  const s = String(desc).toLowerCase();

  return (
    s.includes('wallet transfer') ||
    s.includes('transfer from') ||
    s.includes('transfer to') ||
    s.includes('deposit') ||
    s.includes('top up') ||
    s.includes('cash in') ||
    s.includes('cash-in') ||
    s.includes('withdraw') ||
    s.includes('withdrawal')
  );
};

const isLikelyPositiveExpense = (row = {}) => {
  const n = Number(row.amount || 0);
  if (!(n > 0)) return false;

  const s = String(row.description || '').toLowerCase();

  const incomeLike =
    s.includes('salary') ||
    s.includes('income') ||
    s.includes('allowance') ||
    s.includes('bonus') ||
    s.includes('refund') ||
    s.includes('rebate') ||
    s.includes('cashback') ||
    s.includes('receive') ||
    s.includes('received');

  if (incomeLike) return false;
  if (isNonExpenseMovement(s)) return false;

  return true;
};

const isGoalTxn = (row = {}) => {
  const d = String(row.description || '')
    .trim()
    .toLowerCase();
  const t = String(row.type || row.kind || '').toLowerCase();
  const src = String(row.source || '').toLowerCase();
  const cat = String(row.category || '').toLowerCase();

  return Boolean(
    row.goalId ||
      row.goal ||
      row?.meta?.goalId ||
      t.includes('goal') ||
      src === 'goal' ||
      cat.includes('savings') ||
      cat.includes('goal') ||
      d === '-' ||
      d === 'goal' ||
      d === 'savings' ||
      d === 'savings goal'
  );
};

const inferGoalOp = (row = {}) => {
  const m = String(
    row.goalOp ||
      row?.meta?.goalOp ||
      row?.meta?.op ||
      row.type ||
      row.kind ||
      ''
  ).toLowerCase();

  if (m.includes('refund') || m.includes('return')) {
    return 'refund';
  }

  if (
    m.includes('pay') ||
    m.includes('payment') ||
    m.includes('contribution')
  ) {
    return 'pay';
  }

  return null;
};

const prettyDesc = (row) => {
  if (!isGoalTxn(row)) return row.description || 'Wallet activity';

  const op = inferGoalOp(row);

  if (op === 'pay') return 'Goal payment';
  if (op === 'refund') return 'Goal refund';

  return Number(row.amount) < 0
    ? 'Goal payment'
    : 'Goal refund';
};

const amountPresentation = (row) => {
  if (isGoalTxn(row)) {
    const op =
      inferGoalOp(row) ||
      (Number(row.amount) < 0 ? 'pay' : 'refund');

    return {
      text: `${op === 'pay' ? '−' : '+'}${peso2(row.amount)}`,
      color:
        op === 'pay' ? palette.danger : palette.success,
      positive: op !== 'pay',
    };
  }

  if (isLikelyPositiveExpense(row)) {
    return {
      text: `−${peso2(row.amount)}`,
      color: palette.danger,
      positive: false,
    };
  }

  const n = Number(row.amount || 0);

  return {
    text: `${n >= 0 ? '+' : '−'}${peso2(n)}`,
    color: n >= 0 ? palette.success : palette.danger,
    positive: n >= 0,
  };
};

const activityIcon = (row) => {
  const desc = String(row?.description || '').toLowerCase();

  if (isGoalTxn(row)) return 'flag-outline';
  if (desc.includes('transfer')) return 'swap-horizontal-outline';
  if (
    desc.includes('deposit') ||
    desc.includes('income') ||
    desc.includes('salary') ||
    desc.includes('top up') ||
    desc.includes('cash in')
  ) {
    return 'arrow-down-outline';
  }

  if (
    desc.includes('withdraw') ||
    Number(row?.amount) < 0 ||
    isLikelyPositiveExpense(row)
  ) {
    return 'arrow-up-outline';
  }

  return 'wallet-outline';
};

export default function WalletDetailScreen() {
  const route = useRoute();
  const { wallet: initialWalletParam } = route.params || {};

  const [wallet, setWallet] = useState(
    initialWalletParam || null
  );

  const [expModalVisible, setExpModalVisible] =
    useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');

  const loadWallet = useCallback(async () => {
    if (!initialWalletParam?.id) return;

    const all = (await getData('wallets')) || [];
    const fresh = all.find(
      (w) => w.id === initialWalletParam.id
    );

    if (fresh) setWallet(fresh);
  }, [initialWalletParam?.id]);

  useFocusEffect(
    useCallback(() => {
      loadWallet();
    }, [loadWallet])
  );

  const historySorted = useMemo(
    () =>
      [...(wallet?.expenses || [])].sort((a, b) => {
        const bd = parseDateSafe(b.date)?.getTime() || 0;
        const ad = parseDateSafe(a.date)?.getTime() || 0;
        return bd - ad;
      }),
    [wallet?.expenses]
  );

  const allTimeExpense = useMemo(
    () =>
      (wallet?.expenses || [])
        .filter(
          (x) => !isNonExpenseMovement(x.description)
        )
        .filter(
          (x) =>
            Number(x.amount) < 0 ||
            isLikelyPositiveExpense(x)
        )
        .reduce(
          (sum, x) =>
            sum + Math.abs(Number(x.amount || 0)),
          0
        ),
    [wallet?.expenses]
  );

  const thisMonthExpense = useMemo(() => {
    const now = new Date();

    return (wallet?.expenses || [])
      .filter((row) => {
        const date = parseDateSafe(row.date);

        if (!date) return false;

        const sameMonth =
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth();

        if (!sameMonth) return false;
        if (isNonExpenseMovement(row.description)) return false;

        return (
          Number(row.amount) < 0 ||
          isLikelyPositiveExpense(row)
        );
      })
      .reduce(
        (sum, row) =>
          sum + Math.abs(Number(row.amount || 0)),
        0
      );
  }, [wallet?.expenses]);

  const monthlyCap = Number(wallet?.monthlyCap || 0);

  const capProgress =
    monthlyCap > 0
      ? Math.min(thisMonthExpense / monthlyCap, 1)
      : 0;

  const onConfirmAddExpense = async () => {
    const amt = Number(expAmount);

    if (!expDesc.trim() || !amt || amt <= 0) {
      return Alert.alert(
        'Invalid',
        'Enter a description and positive amount.'
      );
    }

    const currBalance = Number(wallet?.balance || 0);

    if (amt > currBalance) {
      return Alert.alert(
        'Not enough balance',
        'Try a smaller amount.'
      );
    }

    const newExpense = {
      description: expDesc.trim(),
      amount: -Math.abs(amt),
      date: nowStamp(),
    };

    const newWallet = {
      ...wallet,
      balance: currBalance - amt,
      expenses: [
        ...(wallet?.expenses || []),
        newExpense,
      ],
    };

    const all = (await getData('wallets')) || [];
    const updated = all.map((w) =>
      w.id === wallet.id ? newWallet : w
    );

    await saveData('wallets', updated);
    setWallet(newWallet);

    setExpDesc('');
    setExpAmount('');
    setExpModalVisible(false);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>
            WALLET DETAILS
          </Text>

          <Text style={styles.walletName}>
            {wallet?.name || 'Wallet'}
          </Text>
        </View>

        <LinearGradient
          colors={gradients.wallet}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceHero}
        >
          <View style={styles.balanceTop}>
            <View>
              <Text style={styles.balanceLabel}>
                Available balance
              </Text>

              <Text style={styles.balanceValue}>
                {peso2(Number(wallet?.balance || 0))}
              </Text>
            </View>

            <View style={styles.walletIcon}>
              <Ionicons
                name="wallet-outline"
                size={23}
                color="#fff"
              />
            </View>
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>
                This month
              </Text>
              <Text style={styles.heroStatValue}>
                {peso2(thisMonthExpense)}
              </Text>
            </View>

            <View style={styles.heroDivider} />

            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>
                All-time spend
              </Text>
              <Text style={styles.heroStatValue}>
                {peso2(allTimeExpense)}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {monthlyCap > 0 ? (
          <View style={styles.capSection}>
            <View style={styles.capHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>
                  MONTHLY LIMIT
                </Text>
                <Text style={styles.capTitle}>
                  {peso2(thisMonthExpense)} of{' '}
                  {peso2(monthlyCap)}
                </Text>
              </View>

              <Text style={styles.capPercent}>
                {Math.round(capProgress * 100)}%
              </Text>
            </View>

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${capProgress * 100}%`,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.activityHeader}>
          <View>
            <Text style={styles.sectionEyebrow}>
              ACTIVITY
            </Text>

            <Text style={styles.sectionTitle}>
              Transaction history
            </Text>
          </View>

          <Text style={styles.activityCount}>
            {historySorted.length}{' '}
            {historySorted.length === 1
              ? 'entry'
              : 'entries'}
          </Text>
        </View>

        {historySorted.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="swap-vertical-outline"
                size={27}
                color={palette.cyan}
              />
            </View>

            <Text style={styles.emptyTitle}>
              No wallet activity yet
            </Text>

            <Text style={styles.emptyText}>
              Expenses, deposits, transfers, and goal
              movements will appear here.
            </Text>

            <TouchableOpacity
              onPress={() => setExpModalVisible(true)}
              style={styles.emptyAction}
              activeOpacity={0.85}
            >
              <Text style={styles.emptyActionText}>
                Add first expense
              </Text>

              <Ionicons
                name="arrow-forward"
                size={14}
                color={palette.cyan}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.historyList}>
            {historySorted.map((row, index) => {
              const amount = amountPresentation(row);

              return (
                <View
                  key={`${row.date || 'row'}-${index}`}
                  style={[
                    styles.historyRow,
                    index !== historySorted.length - 1 &&
                      styles.historyRowBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.historyIcon,
                      amount.positive
                        ? styles.historyIconPositive
                        : styles.historyIconNegative,
                    ]}
                  >
                    <Ionicons
                      name={activityIcon(row)}
                      size={18}
                      color={
                        amount.positive
                          ? palette.success
                          : palette.danger
                      }
                    />
                  </View>

                  <View style={styles.historyCopy}>
                    <Text
                      style={styles.historyTitle}
                      numberOfLines={1}
                    >
                      {prettyDesc(row)}
                    </Text>

                    <Text style={styles.historyDate}>
                      {friendlyDateTime(row.date)}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.historyAmount,
                      { color: amount.color },
                    ]}
                  >
                    {amount.text}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        onPress={() => setExpModalVisible(true)}
        activeOpacity={0.9}
        style={styles.fabWrap}
        accessibilityLabel="Add expense"
      >
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <Ionicons
            name="add"
            size={28}
            color="#fff"
          />
        </LinearGradient>
      </TouchableOpacity>

      <Modal
        visible={expModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setExpModalVisible(false)
        }
      >
        <KeyboardAvoidingView
          behavior={
            Platform.OS === 'ios' ? 'padding' : undefined
          }
          style={styles.overlay}
        >
          <TouchableWithoutFeedback
            onPress={Keyboard.dismiss}
          >
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />

              <Text style={styles.sheetEyebrow}>
                NEW TRANSACTION
              </Text>

              <Text style={styles.sheetTitle}>
                Add expense
              </Text>

              <Text style={styles.sheetSubtitle}>
                This will deduct money from{' '}
                {wallet?.name || 'this wallet'}.
              </Text>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  Description
                </Text>

                <TextInput
                  placeholder="e.g. Lunch, Grab ride"
                  placeholderTextColor={palette.muted}
                  value={expDesc}
                  onChangeText={setExpDesc}
                  style={styles.input}
                  selectionColor={palette.cyan}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  Amount
                </Text>

                <View style={styles.amountInputWrap}>
                  <Text style={styles.currencyPrefix}>
                    ₱
                  </Text>

                  <TextInput
                    placeholder="0.00"
                    placeholderTextColor={palette.muted}
                    keyboardType="decimal-pad"
                    value={expAmount}
                    onChangeText={setExpAmount}
                    style={styles.amountInput}
                    selectionColor={palette.cyan}
                    returnKeyType="done"
                    onSubmitEditing={
                      onConfirmAddExpense
                    }
                  />
                </View>
              </View>

              <View style={styles.sheetActions}>
                <TouchableOpacity
                  onPress={() =>
                    setExpModalVisible(false)
                  }
                  style={styles.cancelButton}
                  activeOpacity={0.84}
                >
                  <Text style={styles.cancelText}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={onConfirmAddExpense}
                  activeOpacity={0.88}
                  style={styles.saveButtonWrap}
                >
                  <LinearGradient
                    colors={gradients.primary}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.saveButton}
                  >
                    <Text style={styles.saveButtonText}>
                      Add expense
                    </Text>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  content: {
    paddingHorizontal: spacing.l,
    paddingTop: 12,
    paddingBottom: 122,
  },

  intro: {
    marginBottom: 15,
  },

  eyebrow: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 5,
  },

  walletName: {
    color: palette.text,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -0.7,
  },

  balanceHero: {
    borderRadius: 29,
    padding: 20,
    overflow: 'hidden',
    ...shadow(9, 0.22),
  },

  balanceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  balanceLabel: {
    color: '#C5D9F7',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  balanceValue: {
    color: '#fff',
    fontSize: 35,
    lineHeight: 42,
    fontWeight: '900',
    letterSpacing: -1,
    marginTop: 4,
  },

  walletIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },

  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.17)',
  },

  heroStat: {
    flex: 1,
  },

  heroStatLabel: {
    color: '#B4C8E7',
    fontSize: 9,
    fontWeight: '700',
  },

  heroStatValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3,
  },

  heroDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginHorizontal: 18,
  },

  capSection: {
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  capHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  sectionEyebrow: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.3,
    marginBottom: 4,
  },

  capTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '900',
  },

  capPercent: {
    color: palette.cyan,
    fontSize: 13,
    fontWeight: '900',
  },

  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: palette.hairline,
    overflow: 'hidden',
    marginTop: 12,
  },

  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: palette.cyan,
  },

  activityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 9,
  },

  sectionTitle: {
    color: palette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: -0.35,
  },

  activityCount: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },

  historyList: {
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  historyRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },

  historyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  historyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
    borderWidth: 1,
  },

  historyIconPositive: {
    backgroundColor: 'rgba(52,214,164,0.10)',
    borderColor: 'rgba(52,214,164,0.20)',
  },

  historyIconNegative: {
    backgroundColor: 'rgba(255,107,122,0.10)',
    borderColor: 'rgba(255,107,122,0.20)',
  },

  historyCopy: {
    flex: 1,
    minWidth: 0,
  },

  historyTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '800',
  },

  historyDate: {
    color: palette.sub,
    fontSize: 10,
    marginTop: 4,
  },

  historyAmount: {
    fontSize: 13,
    fontWeight: '900',
    marginLeft: 10,
  },

  emptyState: {
    paddingVertical: 42,
    alignItems: 'center',
  },

  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cyanSoft,
  },

  emptyTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 15,
  },

  emptyText: {
    color: palette.sub,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 6,
  },

  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 13,
  },

  emptyActionText: {
    color: palette.cyan,
    fontSize: 11,
    fontWeight: '900',
    marginRight: 5,
  },

  fabWrap: {
    position: 'absolute',
    right: 20,
    bottom: 20,
  },

  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow(10, 0.3),
  },

  overlay: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'flex-end',
  },

  sheet: {
    width: '100%',
    backgroundColor: palette.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: palette.borderStrong,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 22,
  },

  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderStrong,
    alignSelf: 'center',
    marginBottom: 17,
  },

  sheetEyebrow: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
  },

  sheetTitle: {
    color: palette.text,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.45,
    marginTop: 4,
  },

  sheetSubtitle: {
    color: palette.sub,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
    marginBottom: 18,
  },

  field: {
    marginBottom: 17,
  },

  fieldLabel: {
    color: palette.textSoft,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 6,
  },

  input: {
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
    color: palette.text,
    fontSize: 15,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },

  amountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
  },

  currencyPrefix: {
    color: palette.cyan,
    fontSize: 21,
    fontWeight: '900',
    marginRight: 8,
  },

  amountInput: {
    flex: 1,
    minHeight: 50,
    color: palette.text,
    fontSize: 21,
    fontWeight: '900',
    paddingVertical: 9,
  },

  sheetActions: {
    flexDirection: 'row',
    marginTop: 6,
  },

  cancelButton: {
    flex: 0.8,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  cancelText: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },

  saveButtonWrap: {
    flex: 1.2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },

  saveButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
});
