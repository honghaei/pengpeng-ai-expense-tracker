import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getCategoryMeta } from '../constants/categoryTiles';
import { palette, radius, spacing } from '../theme/design';

const pad = (n) => String(n).padStart(2, '0');
function safeYMD(input) {
  try {
    if (!input) return '';
    const d = input instanceof Date ? input : new Date(input);
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const y = d.getFullYear(), m = pad(d.getMonth() + 1), day = pad(d.getDate());
    return `${y}-${m}-${day}`;
  } catch { return ''; }
}
function fmt(n) { return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function TxnRow({ item }) {
  const meta = useMemo(() => getCategoryMeta(item?.category), [item?.category]);
  const description = item?.description || item?.category || 'Expense';
  const displayDate = safeYMD(item?.date);

  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>{meta.emoji}</Text>
      </View>

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{description}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {(item?.walletName || 'General')} · {(item?.source || 'Expense')}{displayDate ? ` · ${displayDate}` : ''}
        </Text>
      </View>

      <View style={styles.amountWrap}>
        <Text style={styles.amount}>−{fmt(item?.amount)}</Text>
        <Text style={styles.category} numberOfLines={1}>{item?.category || 'Expense'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    backgroundColor: palette.card,
    padding: 12,
    marginHorizontal: spacing.l,
    marginVertical: 5,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: palette.hairline,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
    marginRight: 12,
  },
  icon: { fontSize: 19 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: palette.text, fontWeight: '800', fontSize: 14 },
  meta: { color: palette.sub, marginTop: 4, fontSize: 11 },
  amountWrap: { minWidth: 94, marginLeft: 10, alignItems: 'flex-end' },
  amount: { color: palette.warn, fontWeight: '900', fontSize: 14 },
  category: { color: palette.muted, fontSize: 10, marginTop: 4, maxWidth: 100 },
});
