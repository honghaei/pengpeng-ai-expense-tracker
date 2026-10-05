import { Platform } from 'react-native';
import { DarkTheme } from '@react-navigation/native';

/*
  Pengpeng UI v2
  ----------
  New visual direction:
  - deep navy foundation
  - electric blue / cyan accent system
  - fewer boxed sections
  - soft glow and layered depth
  - restrained semantic colors
  - backwards-compatible palette keys so existing screens keep working
*/

export const palette = {
  // Foundations
  bg: '#06101F',
  bgDeep: '#030914',
  bgSoft: '#09172A',
  surface: '#0B1B31',
  surface2: '#0E2340',
  surface3: '#112B4D',
  card: '#0C1D35',
  cardStrong: '#102744',
  elevated: '#14345A',

  // Brand
  primary: '#3B82F6',
  primaryStrong: '#69A7FF',
  primaryDim: '#2859C5',
  primarySoft: 'rgba(59,130,246,0.14)',
  cyan: '#4FD9FF',
  cyanSoft: 'rgba(79,217,255,0.14)',
  indigo: '#6378FF',
  violet: '#8B6CFF',

  // Semantic
  info: '#4FD9FF',
  success: '#34D6A4',
  warn: '#F7C95B',
  danger: '#FF6B7A',

  // Type
  text: '#F7FAFF',
  textSoft: '#D5DFEE',
  sub: '#8FA3BF',
  muted: '#5F7392',

  // Lines / overlays
  hairline: '#17304F',
  borderStrong: '#254A73',
  overlay: 'rgba(2, 7, 15, 0.82)',

  // Utility
  white: '#FFFFFF',
  black: '#000000',
};

export const gradients = {
  hero: ['#123D81', '#205FE1', '#4FD9FF'],
  primary: ['#2D66F2', '#4F8DFF', '#4FD9FF'],
  wallet: ['#2862F0', '#4A7CFF', '#655CFF'],
  ai: ['#183C80', '#315EEA', '#705BFF'],
  glow: ['rgba(79,217,255,0.28)', 'rgba(59,130,246,0.06)'],
};

export const spacing = {
  xxs: 4,
  xs: 8,
  s: 12,
  m: 16,
  l: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 52,
};

export const radius = {
  s: 10,
  m: 14,
  l: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
};

export const layout = {
  screenPadding: 20,
  sectionGap: 28,
  contentMaxWidth: 760,
  bottomTabSpace: 112,
};

export const shadow = (elev = 8, opacity = 0.24) =>
  Platform.select({
    ios: {
      shadowColor: palette.primary,
      shadowOpacity: opacity * 0.45,
      shadowRadius: elev * 1.15,
      shadowOffset: { width: 0, height: Math.max(2, elev / 2) },
    },
    android: { elevation: elev },
    default: {},
  });

export const shadowNeutral = (elev = 8, opacity = 0.24) =>
  Platform.select({
    ios: {
      shadowColor: '#000000',
      shadowOpacity: opacity,
      shadowRadius: elev,
      shadowOffset: { width: 0, height: Math.max(2, elev / 2) },
    },
    android: { elevation: elev },
    default: {},
  });

export const text = {
  display: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.9,
    color: palette.text,
  },
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.55,
    color: palette.text,
  },
  h2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: palette.text,
  },
  h3: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    color: palette.text,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.textSoft,
  },
  bodyStrong: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
    color: palette.text,
  },
  sub: {
    fontSize: 12,
    lineHeight: 18,
    color: palette.sub,
  },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: palette.sub,
  },
  micro: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    color: palette.muted,
  },
};

export const navTheme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: palette.primaryStrong,
    background: palette.bg,
    card: palette.bgDeep,
    text: palette.text,
    border: palette.hairline,
    notification: palette.danger,
  },
};
