import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { ShelfStaggerEnter } from '../../components/ui/ShelfStaggerEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { AppButton } from '../../components/ui/AppButton';
import { openDrawer } from '../../utils/nav';
import { BARBERSHOP_MAP_QUERY, BARBERSHOP_PHONE_INTL } from '../../lib/config';
import { colors, spacing, radius, presets, textStyles, shadows, iconSize, layout } from '../../theme';

export function DirectionsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();

  const openWaze = () =>
    Linking.openURL(`https://waze.com/ul?q=${encodeURIComponent(BARBERSHOP_MAP_QUERY)}`);

  const openGoogleMaps = () =>
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BARBERSHOP_MAP_QUERY)}`,
    );

  const callShop = () => Linking.openURL(`tel:${BARBERSHOP_PHONE_INTL}`);

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={t('screenTitles.Directions')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView contentContainerStyle={presets.scrollContent} showsVerticalScrollIndicator={false}>
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          <PageIntro compact title={t('directions.pageTitle')} />
        <ShelfStaggerEnter index={0}>
        <View style={styles.card}>
          <View style={styles.mapIconWrap}>
            <Ionicons name="location" size={40} color={colors.accent} />
          </View>
          <Text style={styles.addressHint}>{t('directions.addressHint')}</Text>
          <AppButton title={t('directions.waze')} onPress={openWaze} variant="primary" style={styles.cta} />
          <AppButton
            title={t('directions.googleMaps')}
            onPress={openGoogleMaps}
            variant="secondary"
            style={styles.ctaSecondary}
          />
          <TouchableOpacity style={styles.phoneRow} onPress={callShop} activeOpacity={0.8}>
            <Ionicons name="call-outline" size={iconSize.md} color={colors.accent} />
            <Text style={styles.phoneText}>{t('directions.callSalon')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        </ShelfStaggerEnter>
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: 'stretch',
    ...shadows.card,
    shadowOpacity: 0.07,
    elevation: 3,
  },
  mapIconWrap: {
    alignSelf: 'center',
    marginBottom: spacing.sm,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.accent + '33',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addressHint: {
    ...textStyles.bodySmall,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.md,
    color: colors.textSecondary,
  },
  cta: { marginBottom: spacing.sm, minHeight: layout.hitMin - 4, paddingVertical: 12 },
  ctaSecondary: { marginBottom: spacing.md, minHeight: layout.hitMin - 4, paddingVertical: 12 },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
    ...shadows.card,
    shadowOpacity: 0.05,
    elevation: 1,
  },
  phoneText: {
    flex: 1,
    ...textStyles.bodyMedium,
    marginHorizontal: spacing.md,
    textAlign: 'right',
  },
});
