import type { ComponentProps } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, textStyles, iconSize } from '../../theme';

interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
}

export function EmptyState({
  title,
  message = 'אין נתונים',
  icon = 'folder-open-outline',
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={iconSize.emptyState} color={colors.textTertiary} />
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={[styles.text, !title && styles.textOnly]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  title: {
    ...textStyles.sectionTitle,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  text: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  textOnly: {
    marginTop: spacing.md,
  },
});
