import { Text, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { colors, radius, spacing, textStyles, shadows, layout } from '../../theme';
import { ScalePressable } from './ScalePressable';

interface AppButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  compact,
}: AppButtonProps) {
  const isPrimary = variant === 'primary';
  const spinnerColor = isPrimary ? colors.onPrimary : colors.text;

  return (
    <ScalePressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        compact && styles.buttonCompact,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text
          style={[
            isPrimary ? styles.textPrimary : styles.textSecondary,
            compact && (isPrimary ? styles.textPrimaryCompact : styles.textSecondaryCompact),
          ]}
        >
          {title}
        </Text>
      )}
    </ScalePressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.hitMin,
  },
  buttonCompact: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: {
    backgroundColor: colors.surface,
    ...shadows.pillOverlay,
  },
  disabled: { opacity: 0.65 },
  textPrimary: {
    ...textStyles.bodyMedium,
    fontSize: 16,
    color: colors.onPrimary,
    textAlign: 'center',
  },
  textPrimaryCompact: { fontSize: 15 },
  textSecondary: {
    ...textStyles.bodyMedium,
    fontSize: 15,
    color: colors.text,
    textAlign: 'center',
  },
  textSecondaryCompact: { fontSize: 14 },
});
