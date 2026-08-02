import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, Linking, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { ShelfStaggerEnter } from '../../components/ui/ShelfStaggerEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { PageIntro } from '../../components/ui/PageIntro';
import { AppButton } from '../../components/ui/AppButton';
import { openDrawer } from '../../utils/nav';
import { home, icons } from '../../utils/assets';
import { BARBERSHOP_MAP_QUERY, BARBERSHOP_PHONE_INTL, BRAND_NAME, buildWhatsAppChatUrl } from '../../lib/config';
import { useShopBranch } from '../../hooks/useShopBranch';
import { colors, spacing, radius, presets, textStyles, shadows, layout } from '../../theme';

type ActionTileProps = {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  onPress: () => void;
};

function ActionTile({ icon, iconColor, label, onPress }: ActionTileProps) {
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.tileIconWrap, { backgroundColor: iconColor + '18' }]}>
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function DirectionsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  /** Admin-editable shop info (address/phone/links) — first active branch, kept in sync via customer prefetch cache. */
  const shopBranch = useShopBranch();

  const openWaze = () => {
    if (shopBranch?.wazeLink) {
      Linking.openURL(shopBranch.wazeLink);
      return;
    }
    const query = shopBranch?.address || BARBERSHOP_MAP_QUERY;
    Linking.openURL(`https://waze.com/ul?q=${encodeURIComponent(query)}`);
  };

  const openGoogleMaps = () => {
    if (shopBranch?.googleMapsUrl) {
      Linking.openURL(shopBranch.googleMapsUrl);
      return;
    }
    const query = shopBranch?.address || BARBERSHOP_MAP_QUERY;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
  };

  const callShop = () => Linking.openURL(`tel:${shopBranch?.phone || BARBERSHOP_PHONE_INTL}`);
  const openWhatsApp = () => Linking.openURL(buildWhatsAppChatUrl(shopBranch?.phone));
  const openInstagram = () => {
    const url = shopBranch?.instagramUrl;
    if (!url) return;
    const username = url.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');
    const deepLink = `instagram://user?username=${username}`;
    void Linking.canOpenURL(deepLink)
      .then((canOpen) => Linking.openURL(canOpen ? deepLink : url))
      .catch(() => Linking.openURL(url));
  };

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={t('screenTitles.Directions')}
        onBackPress={() => navigation.navigate('Home')}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />
      <ScrollView contentContainerStyle={presets.scrollContent} showsVerticalScrollIndicator={false}>
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
          <PageIntro compact title={t('directions.pageTitle')} subtitle={t('directions.pageSubtitle')} />

          <ShelfStaggerEnter index={0}>
            <View style={styles.card}>
              <View style={styles.photoWrap}>
                <Image source={home.about} style={styles.photo} resizeMode="cover" />
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.65)']}
                  style={styles.photoScrim}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                />
                <View style={styles.photoBadge}>
                  <Ionicons name="location" size={16} color={colors.accent} />
                </View>
                <Text style={styles.photoBrand} numberOfLines={1}>
                  {BRAND_NAME}
                </Text>
              </View>

              <View style={styles.body}>
                <Text style={styles.addressLabel}>{t('directions.addressLabel')}</Text>
                {shopBranch?.address ? (
                  <Text style={styles.addressText}>{shopBranch.address}</Text>
                ) : (
                  <Text style={styles.addressHint}>{t('directions.addressHint')}</Text>
                )}

                <AppButton title={t('directions.waze')} onPress={openWaze} variant="primary" style={styles.cta} />

                <View style={styles.tileGrid}>
                  <ActionTile
                    icon="map-outline"
                    iconColor={colors.accent}
                    label={t('directions.mapsShort')}
                    onPress={openGoogleMaps}
                  />
                  <ActionTile
                    icon="call-outline"
                    iconColor={colors.accent}
                    label={t('directions.callShort')}
                    onPress={callShop}
                  />
                  <ActionTile
                    icon="logo-whatsapp"
                    iconColor="#128C7E"
                    label={t('directions.whatsappShort')}
                    onPress={openWhatsApp}
                  />
                  {shopBranch?.instagramUrl ? (
                    <ActionTile
                      icon="logo-instagram"
                      iconColor="#C13584"
                      label={t('directions.instagramShort')}
                      onPress={openInstagram}
                    />
                  ) : null}
                </View>
              </View>
            </View>
          </ShelfStaggerEnter>

          <ShelfStaggerEnter index={1}>
            <View style={styles.footer}>
              <Image source={icons.logo} style={styles.footerLogo} resizeMode="contain" />
              <Text style={styles.footerText}>{BRAND_NAME}</Text>
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
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...shadows.card,
    shadowOpacity: 0.07,
    elevation: 3,
  },
  photoWrap: {
    width: '100%',
    height: 150,
    position: 'relative',
  },
  photo: { width: '100%', height: '100%' },
  photoScrim: { ...StyleSheet.absoluteFillObject },
  photoBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.md,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoBrand: {
    position: 'absolute',
    bottom: spacing.sm + 6,
    right: spacing.md + 38,
    left: spacing.md,
    ...textStyles.bodyMedium,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'right',
  },
  body: { padding: spacing.lg },
  addressLabel: {
    ...textStyles.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  addressHint: {
    ...textStyles.bodySmall,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: spacing.md,
    color: colors.textSecondary,
  },
  addressText: {
    ...textStyles.bodyMedium,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: spacing.md,
    color: colors.text,
    fontWeight: '600',
  },
  cta: { marginBottom: spacing.md, minHeight: layout.hitMin - 4, paddingVertical: 12 },
  tileGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  tileIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileLabel: {
    ...textStyles.bodySmall,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: spacing.xs,
  },
  footerLogo: { width: 40, height: 40, opacity: 0.85 },
  footerText: { ...textStyles.caption, color: colors.textTertiary, fontWeight: '600' },
});
