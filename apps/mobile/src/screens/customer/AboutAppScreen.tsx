import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { openDrawer } from '../../utils/nav';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { RATE_APP_URL, BARBERSHOP_MAP_QUERY, BRAND_NAME } from '../../lib/config';
import { colors, spacing, radius, presets, textStyles, shadows, iconSize } from '../../theme';
import { Ionicons } from '@expo/vector-icons';

type Props = DrawerScreenProps<RootDrawerParamList, 'AboutApp'>;

export function AboutAppScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { returnTo } = route.params;
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={t('about.screenTitle')}
        onBackPress={() => navigation.navigate(returnTo)}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={presets.scrollContent} showsVerticalScrollIndicator={false}>
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <View style={styles.hero}>
          <View style={styles.logoMark}>
            <Ionicons name="cut" size={iconSize.emptyState} color={colors.accent} />
          </View>
          <Text style={styles.appName}>{BRAND_NAME}</Text>
          <Text style={styles.tagline}>{t('about.tagline')}</Text>
          <Text style={styles.version}>{t('about.version', { version })}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('about.aboutBusiness')}</Text>
          <Text style={styles.body}>{t('about.businessBody', { query: BARBERSHOP_MAP_QUERY })}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('about.devTitle')}</Text>
          <Text style={styles.body}>{t('about.devBody')}</Text>
        </View>

        {RATE_APP_URL ? (
          <TouchableOpacity style={styles.rateBtn} onPress={() => Linking.openURL(RATE_APP_URL)} activeOpacity={0.85}>
            <Ionicons name="star-outline" size={iconSize.lg} color={colors.onPrimary} />
            <Text style={styles.rateBtnText}>{t('about.rateStore')}</Text>
          </TouchableOpacity>
        ) : null}
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
  },
  logoMark: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.accent + '66',
    marginBottom: spacing.md,
    ...shadows.card,
  },
  appName: {
    ...textStyles.pageTitle,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  tagline: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  version: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  sectionTitle: {
    ...textStyles.sectionTitle,
    marginBottom: spacing.sm,
  },
  body: {
    ...textStyles.bodySmall,
    lineHeight: 22,
  },
  rateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.md,
  },
  rateBtnText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
});
