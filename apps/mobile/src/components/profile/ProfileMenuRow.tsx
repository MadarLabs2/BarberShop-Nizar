import type { ComponentProps } from 'react';
import { TouchableOpacity, Text, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, textStyles, iconSize, shadows } from '../../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type ProfileMenuRowProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  iconColor?: string;
  danger?: boolean;
  style?: ViewStyle;
  /** When false, omit trailing chevron (e.g. external action) */
  showChevron?: boolean;
};

export function ProfileMenuRow({
  icon,
  label,
  onPress,
  iconColor = colors.accent,
  danger = false,
  style,
  showChevron = true,
}: ProfileMenuRowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, style]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={iconSize.lg} color={danger ? colors.danger : iconColor} />
      <Text style={[styles.label, danger && styles.labelDanger]}>{label}</Text>
      {showChevron ? <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textMuted} /> : <View style={styles.chevronSpacer} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  label: {
    flex: 1,
    ...textStyles.body,
    marginRight: spacing.md,
    textAlign: 'right',
  },
  labelDanger: {
    color: colors.danger,
  },
  chevronSpacer: {
    width: iconSize.sm,
  },
});
