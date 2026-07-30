import { TextInput, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, layout } from '../../theme';

interface AppInputProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'numeric' | 'number-pad';
  maxLength?: number;
  style?: StyleProp<TextStyle>;
  textAlign?: 'left' | 'center' | 'right';
  /**
   * Accessible name announced by VoiceOver/TalkBack. Falls back to `placeholder` when omitted —
   * better than nothing, but a placeholder is often a format example ("05X-XXXXXXX") rather than
   * a field name, and stops being read once a value is typed. Pass an explicit label (e.g. "מספר
   * טלפון") wherever the placeholder alone wouldn't tell a screen reader user what the field is for.
   */
  accessibilityLabel?: string;
  /** True marks the field as required for screen readers (visual asterisk, if any, is separate). */
  required?: boolean;
  /** Surfaces a validation error to screen readers via accessibilityState + a live announcement hint. */
  errorMessage?: string;
}

export function AppInput({
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  maxLength,
  style,
  textAlign = 'left',
  accessibilityLabel,
  required,
  errorMessage,
}: AppInputProps) {
  const { t } = useTranslation();
  const baseLabel = accessibilityLabel ?? placeholder;
  // RN has no dedicated "required"/"invalid" accessibility state for text fields — the correct
  // pattern is folding that into the announced label/hint text itself.
  const fullLabel = required && baseLabel ? `${baseLabel}, ${t('common.requiredFieldA11y')}` : baseLabel;
  return (
    <TextInput
      style={[styles.input, style, { textAlign }, !!errorMessage && styles.inputError]}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      maxLength={maxLength}
      accessibilityLabel={fullLabel}
      accessibilityHint={errorMessage}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    minHeight: layout.hitMin,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
});
