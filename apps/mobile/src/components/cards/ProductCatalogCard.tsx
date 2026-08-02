import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  type ImageStyle,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { CatalogProduct } from '../../services/bookings.api';
import { pickLocalizedName, useAppLocale } from '../../contexts/LocaleContext';
import { colors, spacing, radius, textStyles, shadows } from '../../theme';

/** Compact shelf tile — image fades into white body (RTL-first). */
const CARD_WIDTH = 166;
const IMAGE_HEIGHT = 148;
/** Exported for home shelf layout math — stride = card + trailing gap between tiles. */
export const PRODUCT_CATALOG_CARD_WIDTH = CARD_WIDTH;
/** Horizontal gap between tiles on the home shelf (`gap` on the FlatList content; matches stories rail). */
export const PRODUCT_CATALOG_SHELF_GAP = spacing.sm + 4;

const SALE_BADGE_BG = '#FFD54A';
const PLACEHOLDER_GRADIENT = ['#f5f5f5', '#ebebeb'] as const;
/** Image bottom fade into card white */
const HERO_FADE_COLORS = [
  'transparent',
  'rgba(255,255,255,0.2)',
  'rgba(255,255,255,0.75)',
  colors.surface,
] as const;

const TIMING_IN = { duration: 160, easing: Easing.out(Easing.cubic) };
const TIMING_OUT = { duration: 260, easing: Easing.out(Easing.cubic) };

export type ProductCatalogCardProps = {
  product: CatalogProduct;
  imageUri?: string;
  onCardPress: () => void;
};

export function ProductCatalogCard({
  product,
  imageUri,
  onCardPress,
}: ProductCatalogCardProps) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const displayName = pickLocalizedName(product, locale);
  const outOfStock = product.stockQuantity <= 0;
  const isBarber = Boolean(product.staffId);
  const hasPhoto = Boolean(imageUri && /^https?:\/\//i.test(imageUri));
  const onSale =
    product.salePrice != null && product.price > 0 && product.salePrice < product.price;

  const pressed = useSharedValue(0);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const v = pressed.value;
    // Android: animating elevation/shadow every frame forces a native shadow recompute per
    // frame (expensive, unlike iOS's compositor-cheap layer shadows) — real jank risk on
    // mid-range hardware. Keep the scale feedback; hold shadow/elevation at their resting
    // values on Android instead of interpolating them. iOS keeps the original animated shadow.
    if (Platform.OS === 'android') {
      return {
        transform: [{ scale: interpolate(v, [0, 1], [1, 0.982]) }],
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 5 },
        elevation: 4,
      };
    }
    return {
      transform: [{ scale: interpolate(v, [0, 1], [1, 0.982]) }],
      shadowOpacity: interpolate(v, [0, 1], [0.08, 0.14]),
      shadowRadius: interpolate(v, [0, 1], [16, 22]),
      shadowOffset: { width: 0, height: interpolate(v, [0, 1], [5, 9]) },
      elevation: interpolate(v, [0, 1], [4, 8]),
    };
  });

  const heroZoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 1.04]) }],
  }));

  const onCardPressIn = useCallback(() => {
    pressed.value = withTiming(1, TIMING_IN);
  }, [pressed]);

  const onCardPressOut = useCallback(() => {
    pressed.value = withTiming(0, TIMING_OUT);
  }, [pressed]);

  const displayPrice = onSale ? product.salePrice : product.price;

  return (
    <View style={styles.enteringShell}>
      <Animated.View style={[styles.wrap, cardAnimatedStyle]} accessibilityRole="none">
        <View style={[styles.card, outOfStock && styles.cardMuted]}>
          <Pressable
            onPress={onCardPress}
            onPressIn={onCardPressIn}
            onPressOut={onCardPressOut}
            style={styles.cardTap}
            accessibilityRole="button"
            accessibilityLabel={`${displayName}, ${t('productCard.detailsA11y')}`}
            android_ripple={{ color: 'rgba(0,0,0,0.06)', foreground: true }}
          >
            <View style={styles.hero}>
              <Animated.View style={[styles.heroMediaClip, heroZoomStyle]}>
                {hasPhoto ? (
                  <>
                <ExpoImage
                  recyclingKey={product.id}
                  source={{ uri: imageUri! }}
                  style={styles.heroImage as ImageStyle}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
                    <LinearGradient
                      colors={[...HERO_FADE_COLORS]}
                      locations={[0, 0.45, 0.78, 1]}
                      style={styles.heroFade}
                      pointerEvents="none"
                    />
                  </>
                ) : (
                  <LinearGradient
                    colors={PLACEHOLDER_GRADIENT}
                    style={styles.heroImage}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                  >
                    <View style={styles.emptyHero}>
                      <Ionicons name="image-outline" size={22} color={colors.textTertiary} />
                      <Text style={styles.emptySub}>{t('productCard.imageSoon')}</Text>
                    </View>
                  </LinearGradient>
                )}
              </Animated.View>

              {onSale ? (
                <View style={styles.saleBadge} pointerEvents="none">
                  <Text style={styles.saleBadgeText} numberOfLines={1}>
                    {t('productCard.saleBadge')}
                  </Text>
                </View>
              ) : null}

              {outOfStock ? (
                <View style={styles.stockLayer}>
                  <Text style={styles.stockText}>{t('productCard.outOfStock')}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
                {displayName}
              </Text>
              {isBarber ? (
                <Text style={styles.staffLine} numberOfLines={1}>
                  {product.staffName
                    ? t('productCard.staffPick', { name: product.staffName })
                    : t('productCard.staffRec')}
                </Text>
              ) : null}

              <View style={styles.pricePills}>
                {onSale ? (
                  <View style={[styles.pill, styles.pillWas, styles.pillPriceRow]}>
                    <Text style={[styles.pillWasNum, outOfStock && styles.faded]} numberOfLines={1}>
                      {product.price}
                    </Text>
                    <Text style={[styles.pillWasShekel, outOfStock && styles.faded]} numberOfLines={1}>
                      ₪
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.pill, styles.pillNow, styles.pillPriceRow]}>
                  <Text style={[styles.pillNowNum, outOfStock && styles.faded]} numberOfLines={1}>
                    {displayPrice}
                  </Text>
                  <Text style={[styles.pillNowShekel, outOfStock && styles.faded]} numberOfLines={1}>
                    ₪
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardTap: {
    borderTopStartRadius: radius.lg,
    borderTopEndRadius: radius.lg,
  },
  wrap: {
    width: CARD_WIDTH,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 4,
  },
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  cardMuted: {
    opacity: 0.88,
  },
  enteringShell: {
    alignSelf: 'flex-start',
  },
  hero: {
    height: IMAGE_HEIGHT,
    width: '100%',
    position: 'relative',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  heroMediaClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFade: {
    ...StyleSheet.absoluteFillObject,
  },
  emptyHero: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
  },
  emptySub: {
    ...textStyles.caption,
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
    alignSelf: 'stretch',
  },
  /** Place sale badge at visual top-right on product cards. */
  saleBadge: {
    position: 'absolute',
    top: spacing.sm,
    end: spacing.sm,
    backgroundColor: SALE_BADGE_BG,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    ...shadows.pillOverlay,
    shadowOpacity: 0.08,
    elevation: 2,
  },
  saleBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.primary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  stockLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
    paddingHorizontal: spacing.md,
  },
  body: {
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
    gap: 4,
    backgroundColor: colors.surface,
    alignSelf: 'stretch',
  },
  title: {
    width: '100%',
    alignSelf: 'stretch',
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    lineHeight: 19,
    letterSpacing: -0.15,
    writingDirection: 'rtl',
  },
  staffLine: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pricePills: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
    paddingBottom: 2,
    alignSelf: 'stretch',
  },
  /** Amount then ₪ — matches product sheet `row-reverse` price rows. */
  pillPriceRow: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 3,
  },
  pill: {
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 10,
    maxWidth: '100%',
  },
  pillWas: {
    backgroundColor: '#8a8a8a',
  },
  pillWasNum: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.surface,
    textDecorationLine: 'line-through',
    textAlign: 'right',
    writingDirection: 'rtl',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  pillWasShekel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.surface,
    textDecorationLine: 'line-through',
    writingDirection: 'rtl',
  },
  pillNow: {
    backgroundColor: colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pillNowNum: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.onPrimary,
    textAlign: 'right',
    writingDirection: 'rtl',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  pillNowShekel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.onPrimary,
    writingDirection: 'rtl',
  },
  faded: {
    opacity: 0.5,
  },
});
