/**
 * Barbershop mobile — design foundation (Sprint 1).
 * Warm cream surfaces, dark ink text, gold accent for highlights (not default CTAs).
 * RTL-first: all new UI must use start/end spacing, RTL alignment, and patterns in .cursor/rules/rtl-hebrew-mobile.mdc.
 * Override textAlign only when centering nav/modal titles.
 */
import type { TextStyle } from 'react-native';

/** Core palette — keep small; use semantic keys below in UI */
export const colors = {
  primary: '#1a1a1a',
  accent: '#c9a227',
  accentOrange: '#FF6B35',
  /** Page canvas — white app-wide */
  background: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#f5f5f5',
  text: '#1a1a1a',
  textSecondary: '#6b6b6b',
  textMuted: '#6b6b6b',
  textTertiary: '#949494',
  border: '#e8e4dc',
  borderSubtle: '#efece5',
  headerBg: '#000000',
  danger: '#b91c1c',
  success: '#15803d',
  successMuted: '#dcfce7',
  warning: '#b45309',
  warningMuted: '#fef3c7',
  dangerMuted: '#fee2e2',
  /** Text/icons on filled primary (black) buttons */
  onPrimary: '#ffffff',
  /** Text on dark header */
  onHeader: '#ffffff',
  overlay: 'rgba(0,0,0,0.45)',
  overlayLight: 'rgba(0,0,0,0.4)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

/** Horizontal rhythm + touch — use across Screen, scroll areas, sheets */
export const layout = {
  screenPaddingH: 20,
  screenPaddingBottom: 48,
  /** Minimum tap target (accessibility) */
  hitMin: 48,
  /** Space between major sections on a screen */
  sectionGap: spacing.lg,
  /** Space under section titles */
  sectionTitleMarginBottom: spacing.md,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

/** Ionicons / inline icon sizes — prefer these over magic numbers */
export const iconSize = {
  sm: 18,
  md: 22,
  lg: 24,
  xl: 28,
  emptyState: 48,
};

/**
 * Semantic type scale — RTL defaults. Use for hierarchy: page → section → body → caption.
 * For centered titles (header/modal), override textAlign in the component style.
 */
export const textStyles = {
  pageTitle: {
    fontSize: 24,
    fontWeight: '600' as const,
    color: colors.text,
    textAlign: 'right' as const,
    lineHeight: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: colors.text,
    textAlign: 'right' as const,
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    color: colors.text,
    textAlign: 'right' as const,
    lineHeight: 24,
  },
  bodyMedium: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: colors.text,
    textAlign: 'right' as const,
    lineHeight: 24,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    color: colors.textSecondary,
    textAlign: 'right' as const,
    lineHeight: 22,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textSecondary,
    textAlign: 'right' as const,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.accent,
    textAlign: 'right' as const,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '500' as const,
    color: colors.onHeader,
    textAlign: 'center' as const,
  },
  /** Intro below BlackHeader — matches TeamScreen rhythm */
  heroKicker: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.accent,
    letterSpacing: 0.5,
    textAlign: 'right' as const,
    marginBottom: spacing.xs,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '600' as const,
    color: colors.text,
    textAlign: 'right' as const,
    marginBottom: spacing.sm,
    lineHeight: 32,
  },
  heroSub: {
    fontSize: 16,
    fontWeight: '400' as const,
    color: colors.textSecondary,
    textAlign: 'right' as const,
    lineHeight: 24,
  },
} satisfies Record<string, TextStyle>;

/**
 * @deprecated Prefer `textStyles` for new code. Kept for gradual migration.
 */
export const typography = {
  title: { fontSize: 24, fontWeight: '600' as const },
  titleSmall: { fontSize: 20, fontWeight: '600' as const },
  body: { fontSize: 16 },
  bodySmall: { fontSize: 14 },
  caption: { fontSize: 12 },
};

/** One restrained elevation system — cards + sheets + floating pills only */
export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  cardStrong: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 16,
  },
  pillOverlay: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
};

/** Shared building blocks — cards, chips, scroll padding */
export const presets = {
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden' as const,
    ...shadows.card,
  },
  cardExpanded: { borderColor: colors.accent + '55' },
  sectionTitle: {
    ...textStyles.sectionTitle,
    marginBottom: layout.sectionTitleMarginBottom,
  },
  scrollContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.xl * 2,
  },
  /**
   * First content block under BlackHeader (full-width header + padded scroll).
   * Pair with textStyles.heroKicker / heroTitle / heroSub.
   */
  hero: {
    marginBottom: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heroAccent: {
    alignSelf: 'flex-end' as const,
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginBottom: spacing.md,
  },
  /** iOS-safe Hebrew row: primary on the right, trailing controls on the left */
  rowHebrew: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
  },
  sectionHeaderHebrew: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  expandableHeader: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  expandableBody: {
    padding: spacing.md,
    paddingTop: spacing.sm + 2,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  /** Status / meta badges (neutral) */
  badgeNeutral: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  /** Success / warning / danger chips — pair with textStyles.caption + matching color */
  badgeSuccess: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.successMuted,
  },
  badgeWarning: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.warningMuted,
  },
  badgeDanger: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.dangerMuted,
  },
  /** List block vertical rhythm */
  listItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: 0,
  },
};
