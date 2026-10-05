// src/screens/BillsScreen.js
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import {
  palette,
  gradients,
  radius,
  spacing,
  shadow,
} from '../theme/design';

import { getData } from '../utils/storage';

import {
  listPayables,
  savePayables,
  updatePayable,
  payNow,
  runAutopayTick,
  computeStatus,
  PayableStatus,
} from '../utils/payables';

import {
  cancelPayableNotifications,
  schedulePayableNotifications,
} from '../utils/notifications';

const two = (n) => (n < 10 ? `0${n}` : `${n}`);

const friendlyDate = (value) => {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const isPast = (iso) =>
  new Date(iso).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0);

const isSameMonth = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const isPaidThisMonth = (p) => {
  if (!p?.lastPaidDate) return false;
  const last = new Date(p.lastPaidDate);
  const now = new Date();
  return isSameMonth(last, now);
};

const money = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const iconForPayable = (p) => {
  const value = String(p?.name || '').toLowerCase();

  if (p?.type === 'subscription') {
    if (value.includes('netflix') || value.includes('stream')) return 'play-circle-outline';
    if (value.includes('spotify') || value.includes('music')) return 'musical-notes-outline';
    if (value.includes('cloud') || value.includes('icloud')) return 'cloud-outline';
    if (value.includes('gym')) return 'barbell-outline';
    return 'repeat-outline';
  }

  if (value.includes('water')) return 'water-outline';
  if (value.includes('electric') || value.includes('power')) return 'flash-outline';
  if (value.includes('internet') || value.includes('wifi')) return 'wifi-outline';
  if (value.includes('rent')) return 'home-outline';
  if (value.includes('loan')) return 'cash-outline';
  if (value.includes('tuition')) return 'school-outline';
  if (value.includes('health')) return 'medkit-outline';

  return 'receipt-outline';
};

export default function BillsScreen() {
  const nav = useNavigation();

  const [typeTab, setTypeTab] = useState('bill');
  const [filter, setFilter] = useState('all');

  const [payables, setPayables] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [payingId, setPayingId] = useState(null);

  const load = useCallback(async () => {
    const [ps, ws] = await Promise.all([
      listPayables(),
      getData('wallets').then((x) => x || []),
    ]);

    setPayables(ps);
    setWallets(ws);
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          await runAutopayTick();
        } catch {}
        await load();
      })();
    }, [load])
  );

  const scoped = useMemo(
    () => payables.filter((p) => p.type === typeTab),
    [payables, typeTab]
  );

  const upcomingCount = useMemo(
    () =>
      scoped.filter(
        (p) =>
          p.nextDueDate &&
          computeStatus(p.nextDueDate) !== PayableStatus.OVERDUE
      ).length,
    [scoped]
  );

  const pastDueCount = useMemo(
    () =>
      scoped.filter(
        (p) =>
          p.nextDueDate &&
          computeStatus(p.nextDueDate) === PayableStatus.OVERDUE
      ).length,
    [scoped]
  );

  const dueTotal = useMemo(
    () =>
      scoped.reduce((sum, p) => {
        if (!p?.nextDueDate) return sum;
        return sum + Number(p.amount || 0);
      }, 0),
    [scoped]
  );

  const filtered = useMemo(() => {
    const arr = [...scoped].filter((p) => !p.hidden);

    if (filter === 'paid') return arr.filter((p) => !p.nextDueDate);

    if (filter === 'upcoming') {
      return arr.filter((p) => p.nextDueDate && !isPast(p.nextDueDate));
    }

    if (filter === 'past') {
      return arr.filter((p) => p.nextDueDate && isPast(p.nextDueDate));
    }

    return arr;
  }, [scoped, filter]);

  const listData = useMemo(() => {
    const items = [...filtered];

    if (typeTab === 'subscription') {
      const unpaidThisMonth = items
        .filter((p) => !isPaidThisMonth(p))
        .sort(
          (a, b) =>
            new Date(a.nextDueDate || 0) - new Date(b.nextDueDate || 0)
        );

      const paidThisMonth = items
        .filter((p) => isPaidThisMonth(p))
        .sort(
          (a, b) =>
            new Date(b.lastPaidDate || 0) - new Date(a.lastPaidDate || 0)
        );

      return [...unpaidThisMonth, ...paidThisMonth];
    }

    const unpaid = items
      .filter((p) => !!p.nextDueDate)
      .sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));

    const paid = items
      .filter((p) => !p.nextDueDate)
      .sort(
        (a, b) =>
          new Date(b.lastPaidDate || 0) - new Date(a.lastPaidDate || 0)
      );

    return [...unpaid, ...paid];
  }, [filtered, typeTab]);

  const doPay = async (p) => {
    if (payingId === p.id) return;

    if (p.type === 'subscription' && isPaidThisMonth(p)) {
      Alert.alert(
        'Already paid',
        'This subscription has already been paid for this month.'
      );
      return;
    }

    if (p.type === 'bill' && !p.nextDueDate) return;

    setPayingId(p.id);

    try {
      const overrides = {};

      if (p?.amountType === 'variable' && Number(p?.amount) > 0) {
        overrides.amount = Number(p.amount);
      }

      const res = await payNow(p.id, overrides);

      if (!res?.ok) {
        const reason = res?.reason || '';

        const msg = reason.includes('insufficient')
          ? 'Insufficient balance. Top up your source first.'
          : reason === 'not_found'
            ? 'This item no longer exists.'
            : 'Payment failed. Please try again.';

        Alert.alert('Cannot pay', msg);
        return;
      }

      setPayables((prev) =>
        prev.map((x) => (x.id === p.id ? res.payable : x))
      );

      Alert.alert('Paid', `${p.name} has been paid.`);
    } catch (e) {
      Alert.alert('Payment failed', String(e?.message || e));
    } finally {
      setPayingId(null);
    }
  };

  const toggleAutopay = async (p, value) => {
    const next = await updatePayable({ id: p.id, autopay: value });
    if (next) await load();
  };

  const togglePause = async (p) => {
    const paused = !p.paused;
    const next = await updatePayable({ id: p.id, paused });

    if (next) {
      if (paused) {
        try {
          await cancelPayableNotifications(p.id);
        } catch {}
      } else if (p.nextDueDate) {
        try {
          await schedulePayableNotifications({
            id: p.id,
            title: p.name,
            dueDate: p.nextDueDate,
            paid: false,
          });
        } catch {}
      }

      await load();
    }
  };

  const hidePayable = async (p) => {
    Alert.alert('Hide payment', `Hide "${p.name}" from the list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hide',
        style: 'destructive',
        onPress: async () => {
          const all = await listPayables();
          const next = all.map((x) =>
            x.id === p.id ? { ...x, hidden: true } : x
          );

          try {
            await cancelPayableNotifications(p.id);
          } catch {}

          await savePayables(next);
          await load();
        },
      },
    ]);
  };

  const renderRightActions = (p) => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => hidePayable(p)}
      activeOpacity={0.85}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.deleteActionText}>Hide</Text>
    </TouchableOpacity>
  );

  const Row = ({ item: p, index }) => {
    const isSub = p.type === 'subscription';

    const wallet = wallets.find((w) => w.id === p.walletId);
    const source =
      p.defaultSource === 'wallet' && wallet
        ? wallet.name
        : 'Total balance';

    const isPaidOneTime = p.type === 'bill' && !p.nextDueDate;
    const paidSubThisMonth = p.type === 'subscription' && isPaidThisMonth(p);

    const paying = payingId === p.id;
    const isOverdue =
      !!p.nextDueDate &&
      computeStatus(p.nextDueDate) === PayableStatus.OVERDUE;

    const showPaidBadge = isPaidOneTime || paidSubThisMonth;
    const canPay = !showPaidBadge && !paying;

    const dueText = showPaidBadge
      ? `Paid ${friendlyDate(p.lastPaidDate)}`
      : `Due ${friendlyDate(p.nextDueDate)}`;

    return (
      <Swipeable renderRightActions={() => renderRightActions(p)}>
        <View
          style={[
            styles.payableRow,
            index !== listData.length - 1 && styles.payableRowBorder,
          ]}
        >
          <View style={styles.payableLeft}>
            <View
              style={[
                styles.iconBubble,
                isOverdue && styles.iconBubbleDanger,
                showPaidBadge && styles.iconBubbleSuccess,
              ]}
            >
              <Ionicons
                name={iconForPayable(p)}
                size={22}
                color={
                  isOverdue
                    ? palette.danger
                    : showPaidBadge
                      ? palette.success
                      : palette.cyan
                }
              />
            </View>

            <View style={styles.payableMain}>
              <Text style={styles.payableName} numberOfLines={1}>
                {p.name}
              </Text>

              <View style={styles.metaChipsRow}>
                <View
                  style={[
                    styles.metaChip,
                    isOverdue && styles.metaChipDanger,
                    showPaidBadge && styles.metaChipSuccess,
                  ]}
                >
                  <Text
                    style={[
                      styles.metaChipText,
                      isOverdue && styles.metaChipTextDanger,
                      showPaidBadge && styles.metaChipTextSuccess,
                    ]}
                  >
                    {dueText}
                  </Text>
                </View>

                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{source}</Text>
                </View>
              </View>

              {isSub ? (
                <View style={styles.subscriptionControls}>
                  <TouchableOpacity
                    onPress={() => toggleAutopay(p, !p.autopay)}
                    style={[
                      styles.microControl,
                      p.autopay && styles.microControlActive,
                    ]}
                  >
                    <Ionicons
                      name={p.autopay ? 'flash' : 'flash-outline'}
                      size={13}
                      color={p.autopay ? palette.cyan : palette.sub}
                    />
                    <Text
                      style={[
                        styles.microControlText,
                        p.autopay && styles.microControlTextActive,
                      ]}
                    >
                      {p.autopay ? 'Autopay on' : 'Autopay off'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => togglePause(p)}
                    style={styles.microControl}
                  >
                    <Ionicons
                      name={p.paused ? 'play-outline' : 'pause-outline'}
                      size={13}
                      color={palette.sub}
                    />
                    <Text style={styles.microControlText}>
                      {p.paused ? 'Resume' : 'Pause'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.payableRight}>
            <Text style={styles.amountLabel}>Amount</Text>
            <Text style={styles.payableAmount}>{money(p.amount)}</Text>

            {showPaidBadge ? (
              <View style={styles.paidBadge}>
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={palette.success}
                />
                <Text style={styles.paidBadgeText}>Paid</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => doPay(p)}
                disabled={!canPay}
                style={[
                  styles.payButton,
                  paying && styles.payButtonDisabled,
                ]}
                activeOpacity={0.84}
              >
                <Text style={styles.payButtonText}>
                  {paying ? '...' : 'Pay'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Swipeable>
    );
  };

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Ionicons
          name={typeTab === 'bill' ? 'receipt-outline' : 'repeat-outline'}
          size={30}
          color={palette.cyan}
        />
      </View>

      <Text style={styles.emptyTitle}>
        {typeTab === 'bill' ? 'No bills yet' : 'No subscriptions yet'}
      </Text>

      <Text style={styles.emptyText}>
        {typeTab === 'bill'
          ? 'Add your upcoming bills so due dates and payments stay organized.'
          : 'Add recurring subscriptions to keep monthly charges visible.'}
      </Text>

      <TouchableOpacity
        onPress={() => nav.navigate('AddPayable', { defaultType: typeTab })}
        style={styles.emptyCta}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={18} color={palette.bgDeep} />
        <Text style={styles.emptyCtaText}>
          {typeTab === 'bill' ? 'Add a bill' : 'Add a subscription'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const Header = () => (
    <View>
      <View style={styles.pageIntro}>
        <View style={styles.headingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PAYMENTS</Text>
            <Text style={styles.pageTitle}>Bills & subscriptions</Text>
          </View>

          <TouchableOpacity
            onPress={() =>
              nav.navigate('AddPayable', { defaultType: typeTab })
            }
            style={styles.addTopButton}
            activeOpacity={0.84}
          >
            <Ionicons name="add" size={22} color={palette.cyan} />
          </TouchableOpacity>
        </View>

        <Text style={styles.pageSubtitle}>
          Keep recurring charges, due dates, and upcoming payments visible.
        </Text>
      </View>

      <View style={styles.typeTabs}>
        {[
          { key: 'bill', label: 'Bills' },
          { key: 'subscription', label: 'Subscriptions' },
        ].map(({ key, label }) => {
          const active = typeTab === key;

          return (
            <TouchableOpacity
              key={key}
              onPress={() => {
                setTypeTab(key);
                setFilter('all');
              }}
              style={[styles.typeTab, active && styles.typeTabActive]}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.typeTabText,
                  active && styles.typeTabTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <LinearGradient
        colors={['#0D2B56', '#123D7C', '#155AA8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.summaryBand}
      >
        <View style={styles.summaryMain}>
          <Text style={styles.summaryLabel}>Upcoming total</Text>
          <Text style={styles.summaryValue}>{money(dueTotal)}</Text>
          <Text style={styles.summaryHint}>
            {typeTab === 'bill'
              ? 'Across active bills'
              : 'Across active subscriptions'}
          </Text>
        </View>

        <View style={styles.summarySide}>
          <View style={styles.summaryMini}>
            <Text style={styles.summaryMiniValue}>{upcomingCount}</Text>
            <Text style={styles.summaryMiniLabel}>Upcoming</Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryMini}>
            <Text
              style={[
                styles.summaryMiniValue,
                pastDueCount > 0 && { color: '#FFD0D5' },
              ]}
            >
              {pastDueCount}
            </Text>
            <Text style={styles.summaryMiniLabel}>Past due</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.filterHeader}>
        <Text style={styles.sectionEyebrow}>
          {typeTab === 'bill' ? 'YOUR BILLS' : 'YOUR SUBSCRIPTIONS'}
        </Text>

        <View style={styles.filterRow}>
          {[
            { key: 'all', label: 'All' },
            { key: 'upcoming', label: 'Upcoming' },
            { key: 'past', label: 'Past due' },
            { key: 'paid', label: 'Paid' },
          ].map(({ key, label }) => {
            const active = filter === key;

            return (
              <TouchableOpacity
                key={key}
                onPress={() => setFilter(key)}
                style={[
                  styles.filterChip,
                  active && styles.filterChipActive,
                ]}
                activeOpacity={0.82}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={Row}
        ListHeaderComponent={Header}
        ListEmptyComponent={EmptyState}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />

      <TouchableOpacity
        onPress={() => nav.navigate('AddPayable', { defaultType: typeTab })}
        activeOpacity={0.9}
        style={styles.fabWrap}
      >
        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  listContent: {
    paddingBottom: 118,
  },

  pageIntro: {
    paddingHorizontal: spacing.l,
    paddingTop: 12,
  },

  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  eyebrow: {
    color: palette.cyan,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 6,
  },

  pageTitle: {
    color: palette.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.65,
  },

  pageSubtitle: {
    color: palette.sub,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    maxWidth: 520,
  },

  addTopButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  typeTabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.l,
    marginTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  typeTab: {
    paddingBottom: 11,
    marginRight: 24,
  },

  typeTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: palette.cyan,
  },

  typeTabText: {
    color: palette.sub,
    fontSize: 14,
    fontWeight: '700',
  },

  typeTabTextActive: {
    color: palette.text,
  },

  summaryBand: {
    marginHorizontal: spacing.l,
    marginTop: 20,
    borderRadius: radius.xl,
    paddingHorizontal: 20,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    ...shadow(8, 0.22),
  },

  summaryMain: {
    flex: 1,
  },

  summaryLabel: {
    color: '#B9D8FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },

  summaryValue: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 3,
  },

  summaryHint: {
    color: '#A7C5EA',
    fontSize: 11,
    marginTop: 4,
  },

  summarySide: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
  },

  summaryMini: {
    alignItems: 'center',
    minWidth: 54,
  },

  summaryMiniValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },

  summaryMiniLabel: {
    color: '#B4CBE7',
    fontSize: 9,
    marginTop: 2,
  },

  summaryDivider: {
    width: 1,
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginHorizontal: 8,
  },

  filterHeader: {
    paddingHorizontal: spacing.l,
    marginTop: 24,
    marginBottom: 4,
  },

  sectionEyebrow: {
    color: palette.primaryStrong,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 12,
  },

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },

  filterChip: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    marginRight: 7,
    marginBottom: 7,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },

  filterChipActive: {
    backgroundColor: palette.primarySoft,
  },

  filterChipText: {
    color: palette.sub,
    fontSize: 12,
    fontWeight: '700',
  },

  filterChipTextActive: {
    color: palette.cyan,
  },

  payableRow: {
    marginHorizontal: spacing.l,
    minHeight: 104,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  payableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  payableLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    minWidth: 0,
    paddingRight: 12,
  },

  iconBubble: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cyanSoft,
    borderWidth: 1,
    borderColor: 'rgba(79,217,255,0.20)',
    marginRight: 12,
  },

  iconBubbleDanger: {
    backgroundColor: 'rgba(255,107,122,0.10)',
    borderColor: 'rgba(255,107,122,0.20)',
  },

  iconBubbleSuccess: {
    backgroundColor: 'rgba(52,214,164,0.10)',
    borderColor: 'rgba(52,214,164,0.20)',
  },

  payableMain: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },

  payableName: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },

  metaChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  metaChip: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: palette.bgSoft,
    borderWidth: 1,
    borderColor: palette.hairline,
    marginRight: 7,
    marginBottom: 7,
  },

  metaChipDanger: {
    backgroundColor: 'rgba(255,107,122,0.10)',
    borderColor: 'rgba(255,107,122,0.20)',
  },

  metaChipSuccess: {
    backgroundColor: 'rgba(52,214,164,0.10)',
    borderColor: 'rgba(52,214,164,0.20)',
  },

  metaChipText: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '700',
  },

  metaChipTextDanger: {
    color: palette.danger,
  },

  metaChipTextSuccess: {
    color: palette.success,
  },

  subscriptionControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },

  microControl: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.bgSoft,
    marginRight: 7,
    marginTop: 4,
  },

  microControlActive: {
    backgroundColor: palette.cyanSoft,
  },

  microControlText: {
    color: palette.sub,
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 4,
  },

  microControlTextActive: {
    color: palette.cyan,
  },

  payableRight: {
    width: 112,
    alignItems: 'flex-end',
    paddingTop: 2,
  },

  amountLabel: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  payableAmount: {
    color: palette.text,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'right',
    letterSpacing: -0.4,
    marginBottom: 10,
  },

  payButton: {
    minWidth: 68,
    minHeight: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: palette.primary,
  },

  payButtonDisabled: {
    opacity: 0.55,
  },

  payButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },

  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(52,214,164,0.10)',
  },

  paidBadgeText: {
    color: palette.success,
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 3,
  },

  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 42,
    paddingTop: 54,
  },

  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.cyanSoft,
  },

  emptyTitle: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 18,
  },

  emptyText: {
    color: palette.sub,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 310,
  },

  emptyCta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: palette.cyan,
  },

  emptyCtaText: {
    color: palette.bgDeep,
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 5,
  },

  fabWrap: {
    position: 'absolute',
    right: 20,
    bottom: 18,
  },

  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow(10, 0.3),
  },

  deleteAction: {
    width: 76,
    marginRight: spacing.l,
    marginVertical: 8,
    borderRadius: radius.l,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },

  deleteActionText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
});
