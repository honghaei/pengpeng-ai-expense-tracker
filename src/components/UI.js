import React from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { palette, radius, shadow, spacing, text as t } from '../theme/design';

export const Screen = ({ children, scroll = false, contentStyle, style }) =>
  scroll ? (
    <SafeAreaView style={[s.root, style]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, contentStyle]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  ) : (
    <SafeAreaView style={[s.root, style]}>{children}</SafeAreaView>
  );

export const Card = ({ children, style, elevated = false }) => (
  <View style={[s.card, elevated && s.cardElevated, style]}>{children}</View>
);

export const Input = ({ style, ...rest }) => (
  <TextInput
    placeholderTextColor={palette.muted}
    selectionColor={palette.primary}
    style={[s.input, style]}
    {...rest}
  />
);

export const SectionTitle = ({ children, style, subtitle }) => (
  <View style={s.sectionTitleWrap}>
    <Text style={[t.h2, style]}>{children}</Text>
    {subtitle ? <Text style={s.sectionSubtitle}>{subtitle}</Text> : null}
  </View>
);

export const Eyebrow = ({ children, style }) => (
  <Text style={[t.label, { color: palette.primary }, style]}>{children}</Text>
);

export const Banner = ({ color = palette.warn, children, style }) => (
  <View style={[s.banner, { borderColor: color }, style]}>
    <View style={[s.bannerDot, { backgroundColor: color }]} />
    <Text style={[t.body, { flex: 1 }]}>{children}</Text>
  </View>
);

export const Progress = ({ value = 0, color = palette.primary, style }) => (
  <View style={[s.track, style]}>
    <View
      style={[
        s.fill,
        { width: `${Math.min(100, Math.max(0, Number(value) || 0))}%`, backgroundColor: color },
      ]}
    />
  </View>
);

export const Chip = ({ children, active = false, onPress, style }) => {
  const content = (
    <View style={[s.chip, active && s.chipActive, style]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{children}</Text>
    </View>
  );
  return onPress ? (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>{content}</TouchableOpacity>
  ) : content;
};

export const Divider = ({ style }) => <View style={[s.divider, style]} />;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  scroll: { paddingHorizontal: spacing.l, paddingTop: spacing.m, paddingBottom: 44 },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.l,
    padding: spacing.m,
    marginBottom: spacing.s,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  cardElevated: {
    backgroundColor: palette.cardStrong,
    ...shadow(10, 0.18),
  },
  input: {
    minHeight: 48,
    backgroundColor: palette.surface,
    color: palette.text,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: palette.hairline,
    paddingVertical: 11,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  sectionTitleWrap: { marginBottom: spacing.s },
  sectionSubtitle: { ...t.sub, marginTop: 4, maxWidth: 520 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    backgroundColor: palette.surface2,
    borderRadius: radius.m,
    padding: spacing.s,
    marginBottom: spacing.s,
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  track: {
    height: 8,
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.hairline,
    backgroundColor: palette.surface,
  },
  chipActive: { borderColor: palette.primaryDim, backgroundColor: palette.primarySoft },
  chipText: { color: palette.textSoft, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: palette.primary },
  divider: { height: 1, backgroundColor: palette.hairline },
});
