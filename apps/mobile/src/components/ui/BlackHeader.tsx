import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, textStyles, iconSize, layout } from '../../theme';
import { ScalePressable } from './ScalePressable';

interface BlackHeaderProps {
  title: string;
  onBackPress?: () => void;
  onMenuPress?: () => void;
}

export function BlackHeader({ title, onBackPress, onMenuPress }: BlackHeaderProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const paddingTop = Math.max(insets.top, Platform.OS === 'android' ? 24 : 0);

  return (
    <View style={[styles.header, { paddingTop }]}>
      <View style={styles.headerRow}>
        <View style={styles.side}>
          {onBackPress ? (
            <ScalePressable
              onPress={onBackPress}
              style={styles.btn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.backA11y')}
            >
              <Ionicons name="arrow-back" size={iconSize.lg} color={colors.onHeader} />
            </ScalePressable>
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.side}>
          {onMenuPress ? (
            <ScalePressable
              onPress={onMenuPress}
              style={styles.btn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.menuA11y')}
            >
              <Ionicons name="menu" size={iconSize.lg} color={colors.onHeader} />
            </ScalePressable>
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.headerBg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.hitMin,
  },
  side: { minWidth: layout.hitMin, alignItems: 'center' },
  btn: {
    padding: spacing.sm,
    minWidth: layout.hitMin,
    minHeight: layout.hitMin,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: { width: layout.hitMin },
  title: {
    flex: 1,
    ...textStyles.navTitle,
    writingDirection: 'rtl',
  },
});
