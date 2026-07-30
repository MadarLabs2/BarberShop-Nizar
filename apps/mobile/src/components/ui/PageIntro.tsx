import { View, Text, StyleSheet } from 'react-native';
import { presets, textStyles, spacing } from '../../theme';

export interface PageIntroProps {
  /** Main heading (RTL). */
  title: string;
  /** Supporting line under the title. */
  subtitle?: string;
  /**
   * Small brand line above the title. Defaults to “BarberShop”.
   * Pass an empty string to hide.
   */
  kicker?: string;
  /** Gold accent bar on the trailing edge (RTL). Default true. */
  showAccent?: boolean;
  /** Bottom border separator. Default true. */
  showDivider?: boolean;
  /** Tighter spacing and slightly smaller title — e.g. Team list screens. */
  compact?: boolean;
}

/**
 * Post-header intro block — same family as TeamScreen (accent, kicker, title, subtitle, divider).
 * Use inside scroll content with `presets.scrollContent`; pair with `BlackHeader` + `Screen noPadding`.
 */
export function PageIntro({
  title,
  subtitle,
  kicker = '',
  showAccent = true,
  showDivider = false,
  compact = false,
}: PageIntroProps) {
  const showKicker = kicker.length > 0;
  const noSubtitle = !subtitle?.trim();

  return (
    <View
      style={[
        presets.hero,
        compact ? (noSubtitle ? styles.heroCompactTight : styles.heroCompact) : noSubtitle ? styles.heroFullTight : null,
        !showDivider && styles.heroNoDivider,
      ]}
    >
      {showAccent ? (
        <View
          style={[
            presets.heroAccent,
            compact && styles.heroAccentCompact,
            compact && noSubtitle && styles.heroAccentTight,
          ]}
        />
      ) : null}
      {showKicker ? <Text style={textStyles.heroKicker}>{kicker}</Text> : null}
      <Text
        style={[
          textStyles.heroTitle,
          compact && styles.heroTitleCompact,
          noSubtitle && (compact ? styles.heroTitleTightCompact : styles.heroTitleTightFull),
        ]}
      >
        {title}
      </Text>
      {subtitle ? <Text style={[textStyles.heroSub, compact && styles.heroSubCompact]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heroNoDivider: {
    borderBottomWidth: 0,
  },
  /** Compact + subtitle — room for two lines under title */
  heroCompact: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
  },
  /** Compact, no subtitle — keep intro visually attached to content below */
  heroCompactTight: {
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
  },
  /** Full-size intro, no subtitle — less dead space than default `presets.hero` */
  heroFullTight: {
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
  },
  heroAccentCompact: {
    marginBottom: spacing.sm,
  },
  heroAccentTight: {
    marginBottom: spacing.sm,
  },
  heroTitleCompact: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  /** Last line before section body — no gap reserved for subtitle */
  heroTitleTightCompact: {
    marginBottom: spacing.xs,
  },
  heroTitleTightFull: {
    marginBottom: spacing.xs,
  },
  heroSubCompact: {
    fontSize: 14,
    lineHeight: 21,
  },
});
