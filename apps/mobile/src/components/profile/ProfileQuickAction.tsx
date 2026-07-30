import type { ComponentProps } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, textStyles, iconSize, shadows } from '../../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type ProfileQuickActionProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
};

export function ProfileQuickAction({ icon, label, onPress }: ProfileQuickActionProps) {
  return (
    <TouchableOpacity style={styles.wrap} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={iconSize.md} color={colors.accent} />
      </View>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    ...textStyles.caption,
    textAlign: 'center',
    fontWeight: '600',
    color: colors.text,
  },
});
