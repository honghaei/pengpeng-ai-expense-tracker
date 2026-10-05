import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { palette, radius, shadow } from '../theme/design';

export default function CustomButton({
  title,
  onPress,
  variant = 'primary',
  style,
  textStyle,
  disabled,
}) {
  const colors = {
    primary: { bg: palette.primary, fg: palette.bg, border: palette.primary },
    outline: { bg: 'transparent', fg: palette.text, border: palette.borderStrong },
    subtle: { bg: palette.surface2, fg: palette.text, border: palette.hairline },
    danger: { bg: palette.danger, fg: palette.white, border: palette.danger },
  }[variant] || { bg: palette.primary, fg: palette.bg, border: palette.primary };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.86}
      style={[
        styles.btn,
        { backgroundColor: colors.bg, borderColor: colors.border },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.txt, { color: colors.fg }, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.m,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow(5, 0.14),
  },
  txt: { fontWeight: '800', fontSize: 14, letterSpacing: 0.1 },
  disabled: { opacity: 0.45 },
});
