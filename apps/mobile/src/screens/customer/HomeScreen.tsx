import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Image,
  Modal,
  Linking,
  Alert,
  ActivityIndicator,
  AppState,
  InteractionManager,
  Platform,
  DeviceEventEmitter,
  type AppStateStatus,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useEventListener } from 'expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { home, icons } from '../../utils/assets';
import { useCatalogProducts } from '../../hooks/useCatalogProducts';
import { useAuth } from '../../hooks/useAuth';
import { useAppointments } from '../../contexts/AppointmentsContext';
import {
  acceptWaitlistOffer,
  cancelAppointment,
  getPendingWaitlistOffers,
} from '../../services/bookings.api';
import { prefetchAdminHeavyData } from '../../services/adminPrefetchCache';
import { prefetchStaffDashboardData } from '../../services/staffPrefetchCache';
import { prefetchCustomerTabData } from '../../services/customerPrefetchCache';
import { PUSH_NOTIFICATION_RECEIVED_EVENT } from '../../services/push';
import { useShopBranch } from '../../hooks/useShopBranch';
import { useNotifications } from '../../contexts/NotificationsContext';
import type { AppointmentDto, CatalogProduct, WaitlistSlotOffer } from '../../services/bookings.api';
import {
  BRAND_NAME,
  BARBERSHOP_MAP_QUERY,
  BARBERSHOP_PHONE_INTL,
  MADARLABS_CONTACT_PHONE,
  MADARLABS_INSTAGRAM_URL,
  MADARLABS_INSTAGRAM_USERNAME,
  buildProductInquiryWhatsAppUrl,
  buildWhatsAppChatUrl,
} from '../../lib/config';
import { toE164 } from '../../utils/phone';
import { openDrawer } from '../../utils/nav';
import { formatDateDmy } from '../../utils/dates';
import { colors, spacing, radius, shadows, layout, textStyles, iconSize } from '../../theme';
import { LAYOUT_EASE_OUT_SMOOTH } from '../../theme/motion';
import { AppointmentCard } from '../../components/cards/AppointmentCard';
import {
  ProductCatalogCard,
  PRODUCT_CATALOG_CARD_WIDTH,
  PRODUCT_CATALOG_SHELF_GAP,
} from '../../components/cards/ProductCatalogCard';
import { HomeStoriesSection } from '../../components/home/HomeStoriesSection';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { pickLocalizedName, useAppLocale } from '../../contexts/LocaleContext';
import { LanguageSwitcher } from '../../components/settings/LanguageSwitcher';

const VIDEO_HEIGHT = 260;
/** Until onLayout runs — far enough above fold that the card is fully hidden. */
/** Slide down into view: ease-out settle. */
const NOTICE_SLIDE_IN_MS = 340;
/** Slide up off screen: ease-in so it accelerates smoothly upward. */
const NOTICE_SLIDE_OUT_MS = 300;
/** Foreground poll cadence for waitlist-offer visibility while Home is focused — see the effect
 * below for why this can't rely on push delivery alone. */
const WAITLIST_OFFERS_POLL_MS = 5_000;

function isWaitlistSlotLostRaceMessage(msg: string): boolean {
  return (
    msg.includes('הספיק לאשר') ||
    msg.includes('נתפסה — נשארת') ||
    msg.includes('נתפסה על ידי לקוח אחר')
  );
}

function alertWaitlistAcceptFailure(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (isWaitlistSlotLostRaceMessage(msg)) {
    Alert.alert(i18n.t('home.waitlistSomeoneElseTitle'), i18n.t('home.waitlistSomeoneElseMsg'));
    return;
  }
  Alert.alert(i18n.t('home.cannotBook'), msg || i18n.t('common.tryAgain'));
}

function HeroVideo({ style }: { style?: object }) {
  const player = useVideoPlayer(home.video, (p) => {
    p.loop = true;
    p.muted = false;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!isPlaying) {
      requestAnimationFrame(() => {
        try { player.play(); } catch { /* ignore */ }
      });
    }
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') player.play();
      if (next === 'background' || next === 'inactive') player.pause();
    });
    return () => sub.remove();
  }, [player]);

  return <VideoView player={player} style={style} contentFit="cover" nativeControls={false} />;
}

class VideoErrorBoundary extends React.Component<
  { style?: object; children?: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError = () => ({ hasError: true });
  render() {
    if (this.state.hasError) {
      return (
        <View style={this.props.style}>
          <Image source={home.hero} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </View>
      );
    }
    return this.props.children;
  }
}

function HomeHero({ style }: { style?: object }) {
  return (
    <VideoErrorBoundary style={style}>
      <HeroVideo style={style} />
    </VideoErrorBoundary>
  );
}
/**
 * Poster for one frame tick, then video — lighter than `runAfterInteractions` (faster start, still skips video init on first paint).
 */
function DeferredHomeHero({ style }: { style?: object }) {
  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => {
    // Wait for drawer transition to fully settle before mounting the heavy native VideoView.
    // InteractionManager fires after all animations complete — avoids video init racing the slide-in.
    const handle = InteractionManager.runAfterInteractions(() => {
      setShowVideo(true);
    });
    return () => handle.cancel();
  }, []);
  if (!showVideo) {
    return <Image source={home.hero} style={style as object} resizeMode="cover" />;
  }
  return <HomeHero style={style} />;
}
const MemoDeferredHomeHero = React.memo(DeferredHomeHero);

function HomeNoticeBanner({ expanded, onDismiss }: { expanded: boolean; onDismiss: () => void }) {
  const { t } = useTranslation();
  const NOTICE_SLIDE_HEIGHT = 420;
  const noticeTranslateY = useSharedValue(-NOTICE_SLIDE_HEIGHT);

  useEffect(() => {
    if (expanded) {
      noticeTranslateY.value = withTiming(0, { duration: 400, easing: LAYOUT_EASE_OUT_SMOOTH });
    }
  }, [expanded, noticeTranslateY]);

  const dismiss = useCallback(() => {
    noticeTranslateY.value = withTiming(
      -NOTICE_SLIDE_HEIGHT,
      { duration: 350, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) scheduleOnRN(onDismiss);
      },
    );
  }, [noticeTranslateY, onDismiss]);

  const noticeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: noticeTranslateY.value }],
  }));

  if (!expanded) return null;
  return (
    <View style={homeStyles.noticeOverlay} pointerEvents="box-none">
      <TouchableOpacity activeOpacity={1} onPress={dismiss} style={homeStyles.noticeOverlayTouch}>
        <Animated.View style={[homeStyles.noticeCard, noticeAnimatedStyle]}>
          <Text style={homeStyles.noticeTitle}>{t('home.noticeTitle')}</Text>
          <Text style={homeStyles.noticeBodyText}>{t('home.noticeBody')}</Text>
          <View style={homeStyles.noticeCollapse}>
            <Ionicons name="chevron-up" size={24} color={colors.accent} />
          </View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}
const MemoHomeNoticeBanner = React.memo(HomeNoticeBanner);

function ProductDetailSheet({
  product,
  imageUri,
  onClose,
  onWhatsApp,
}: {
  product: CatalogProduct | null;
  imageUri?: string;
  onClose: () => void;
  onWhatsApp: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const sheetInsets = useSafeAreaInsets();
  if (!product) return null;
  const hasRemoteImage = Boolean(imageUri && /^https?:\/\//i.test(imageUri));
  const displayName = pickLocalizedName(product, locale);
  const descHe = product.descriptionHe?.trim();
  const descAr = product.descriptionAr?.trim();
  const desc = (locale === 'ar' ? descAr || descHe : descHe || descAr) || product.description?.trim();
  const isBarber = Boolean(product.staffId);
  const outOfStock = product.stockQuantity <= 0;
  const onSale = product.salePrice != null && product.price > 0 && product.salePrice < product.price;
  const discountPct =
    onSale && product.price > 0
      ? Math.max(1, Math.round((1 - (product.salePrice as number) / product.price) * 100))
      : 0;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={homeStyles.productSheetOverlay}>
        <Pressable style={homeStyles.productSheetBackdrop} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={homeStyles.productSheetCard}>
          <View style={homeStyles.productSheetHandle} />
          <View style={homeStyles.productSheetHeaderRow}>
            <TouchableOpacity
              onPress={onClose}
              style={homeStyles.productSheetClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={homeStyles.productSheetScroll}
            contentContainerStyle={homeStyles.productSheetScrollContent}
            showsVerticalScrollIndicator={false}
            bounces
          >
            <View style={homeStyles.productSheetHero}>
              {onSale && discountPct > 0 ? (
                <View style={homeStyles.productSheetSaleBadge} pointerEvents="none">
                  <Text style={homeStyles.productSheetSaleBadgeText}>
                    {t('productCard.saleLabel', { pct: discountPct })}
                  </Text>
                  <Ionicons name="pricetag" size={14} color={colors.accent} />
                </View>
              ) : null}
              {hasRemoteImage ? (
                <ExpoImage
                  source={{ uri: imageUri! }}
                  style={homeStyles.productSheetHeroImgContain}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : (
                <LinearGradient
                  colors={['#f5f3ef', '#ebe6de']}
                  style={homeStyles.productSheetHeroImg}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                >
                  <View style={homeStyles.productSheetHeroEmpty}>
                    <Ionicons name="image-outline" size={40} color={colors.textTertiary} />
                    <Text style={homeStyles.productSheetHeroEmptyText}>{t('productCard.imageSoon')}</Text>
                  </View>
                </LinearGradient>
              )}
              {outOfStock ? (
                <View style={homeStyles.productSheetStockBadge}>
                  <Text style={homeStyles.productSheetStockBadgeText}>{t('productCard.outOfStock')}</Text>
                </View>
              ) : null}
            </View>

            <Text style={homeStyles.productSheetTitle}>{displayName}</Text>

            <View style={homeStyles.productSheetMetaRow}>
              <View style={homeStyles.productSheetPriceCol}>
                {onSale ? (
                  <View style={homeStyles.productSheetWasRow}>
                    <Text style={[homeStyles.productSheetWasNum, outOfStock && homeStyles.productSheetMuted]}>
                      {product.price}
                    </Text>
                    <Text style={[homeStyles.productSheetWasShekel, outOfStock && homeStyles.productSheetMuted]}>₪</Text>
                  </View>
                ) : null}
                <View style={homeStyles.productSheetPriceRow}>
                  <Text
                    style={[
                      homeStyles.productSheetPriceNum,
                      onSale && homeStyles.productSheetPriceNumSale,
                      outOfStock && homeStyles.productSheetMuted,
                    ]}
                    numberOfLines={1}
                  >
                    {onSale ? product.salePrice : product.price}
                  </Text>
                  <Text
                    style={[
                      homeStyles.productSheetShekel,
                      onSale && homeStyles.productSheetShekelSale,
                      outOfStock && homeStyles.productSheetMuted,
                    ]}
                  >
                    ₪
                  </Text>
                </View>
              </View>
              {product.category ? (
                <View style={homeStyles.productSheetChip}>
                  <Text style={homeStyles.productSheetChipText}>{product.category}</Text>
                </View>
              ) : null}
            </View>

            {isBarber ? (
              <View style={homeStyles.productSheetHintRow}>
                <Ionicons name="sparkles" size={16} color={colors.accent} />
                <Text style={homeStyles.productSheetHint}>
                  {product.staffName ? t('home.productStaffPick', { name: product.staffName }) : t('home.productStaffRec')}
                </Text>
              </View>
            ) : null}

            {desc ? (
              <>
                <Text style={homeStyles.productSheetSectionLabel}>{t('home.aboutProduct')}</Text>
                <Text style={homeStyles.productSheetBody}>{desc}</Text>
              </>
            ) : (
              <Text style={homeStyles.productSheetBodyMuted}>
                {isBarber ? t('home.productHintBarber') : t('home.productHintShop')}
              </Text>
            )}
          </ScrollView>

          <View style={[homeStyles.productSheetFooter, { paddingBottom: Math.max(sheetInsets.bottom, spacing.md) }]}>
            <TouchableOpacity
              style={homeStyles.productSheetWa}
              onPress={onWhatsApp}
              activeOpacity={0.88}
            >
              <Ionicons name="logo-whatsapp" size={22} color="#128C7E" />
              <Text style={homeStyles.productSheetWaText}>{t('home.sendWhatsApp')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function HomeAppointmentModal({
  appointment,
  onClose,
  onCall,
  onNavigate,
  onCancel,
}: {
  appointment: AppointmentDto | null;
  onClose: () => void;
  onCall: () => void;
  onNavigate: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!appointment) return null;
  return (
    <Modal visible={!!appointment} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={homeStyles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={homeStyles.modalContent} onStartShouldSetResponder={() => true}>
          <View style={homeStyles.modalHandle} />
          <TouchableOpacity style={homeStyles.modalBtn} onPress={onCall}>
            <Ionicons name="call-outline" size={22} color={colors.text} />
            <Text style={homeStyles.modalBtnText}>{t('home.modalCall')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={homeStyles.modalBtn} onPress={onNavigate}>
            <Ionicons name="navigate-outline" size={22} color={colors.text} />
            <Text style={homeStyles.modalBtnText}>{t('home.modalNavigate')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[homeStyles.modalBtn, homeStyles.modalBtnCancel]} onPress={onCancel}>
            <Ionicons name="close-circle-outline" size={22} color="#c62828" />
            <Text style={[homeStyles.modalBtnText, homeStyles.modalBtnTextCancel]}>{t('home.modalCancelAppt')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

function HomeContentSections({
  aboutFlipped,
  onAboutPress,
}: {
  aboutFlipped: boolean;
  onAboutPress: () => void;
}) {
  const { t } = useTranslation();
  const flipRotation = useSharedValue(0);
  const handleAboutPress = () => {
    flipRotation.value = withTiming(aboutFlipped ? 0 : 180, {
      duration: 240,
      easing: LAYOUT_EASE_OUT_SMOOTH,
    });
    onAboutPress();
  };
  const flipFrontStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${flipRotation.value}deg` }],
    backfaceVisibility: 'hidden' as const,
  }));
  const flipBackStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${flipRotation.value + 180}deg` }],
    backfaceVisibility: 'hidden' as const,
  }));
  return (
    <>
      <HomeStoriesSection />
      <View style={homeStyles.flipCardWrapper}>
        <View style={homeStyles.flipCardInner}>
          <Animated.View style={[homeStyles.flipFace, homeStyles.flipFaceFront, flipFrontStyle]}>
            <Image source={home.about} style={homeStyles.salonImage} resizeMode="cover" />
          </Animated.View>
          <Animated.View style={[homeStyles.flipFace, homeStyles.flipFaceBack, flipBackStyle]}>
            <Text style={homeStyles.aboutText}>{t('home.aboutBody')}</Text>
          </Animated.View>
        </View>
      </View>
      <TouchableOpacity style={homeStyles.aboutButton} onPress={handleAboutPress} activeOpacity={0.88}>
        <Ionicons
          name={aboutFlipped ? 'chevron-up' : 'information-circle-outline'}
          size={iconSize.sm}
          color={colors.accent}
        />
        <Text style={homeStyles.aboutButtonText}>{aboutFlipped ? t('home.aboutClose') : t('home.aboutOpen')}</Text>
      </TouchableOpacity>
    </>
  );
}
const MemoHomeContentSections = React.memo(HomeContentSections);

export function HomeScreen() {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  const insets = useSafeAreaInsets();
  const { isLoggedIn, user, token, isAdmin, hasStaffProfile, isPureCustomer, isRestored } = useAuth();
  const { upcoming, refresh, updateUpcoming, invalidate, forceRefresh } = useAppointments();
  const { refresh: refreshNotifications } = useNotifications();
  const catalogProducts = useCatalogProducts(token ?? null, isRestored);
  const [noticeExpanded, setNoticeExpanded] = useState(true);
  const [aboutFlipped, setAboutFlipped] = useState(false);
  const [appointmentMenuFor, setAppointmentMenuFor] = useState<AppointmentDto | null>(null);
  const [productDetailFor, setProductDetailFor] = useState<CatalogProduct | null>(null);
  const [waitlistOffers, setWaitlistOffers] = useState<WaitlistSlotOffer[]>([]);
  /** Admin-editable shop info (address/phone/email/Instagram) — first active branch, kept in sync via customer prefetch cache. */
  const shopBranch = useShopBranch();
  const riseY = useSharedValue(14);
  const riseOp = useSharedValue(0);
  const riseStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: riseY.value }],
    opacity: riseOp.value,
  }));
  useFocusEffect(
    useCallback(() => {
      // Reset to hidden state immediately so content is invisible during the drawer slide.
      riseY.value = 14;
      riseOp.value = 0;
      // Only animate IN after the drawer transition fully settles — this is identical to
      // AdminDashboard's ScreenEnter "rise" variant but without remounting the component tree.
      const handle = InteractionManager.runAfterInteractions(() => {
        riseY.value = withTiming(0, { duration: 380, easing: LAYOUT_EASE_OUT_SMOOTH });
        riseOp.value = withTiming(1, { duration: 300, easing: LAYOUT_EASE_OUT_SMOOTH });
      });
      return () => handle.cancel();
    }, [riseY, riseOp]),
  );

  /**
   * Freed-slot offers need to appear as close to instantly as possible — this is a "first to
   * confirm wins" race between customers, so lateness has a real cost. Push delivery (APNs/FCM)
   * is best-effort and outside the app's control — it can lag or occasionally not arrive at all —
   * so it can't be the only mechanism. Two layers:
   *  1. While Home is focused: fetch once immediately, then poll every few seconds — a hard
   *     ceiling on latency whenever the customer is actually looking at this screen, independent
   *     of whether any push ever arrives. Paused while the app is backgrounded (checked per tick,
   *     cheap) so it doesn't burn battery/network for a screen nobody can see.
   *  2. From anywhere else in the app: the push listener below reacts the instant a freed-slot
   *     notification lands, so the card is already correct if/when the customer comes back to
   *     Home — it just can't be the *only* path given push timing isn't guaranteed.
   */
  useFocusEffect(
    useCallback(() => {
      if (!token) {
        setWaitlistOffers([]);
        return;
      }
      let cancelled = false;
      const poll = () => {
        if (cancelled || AppState.currentState !== 'active') return;
        getPendingWaitlistOffers(token)
          .then((next) => {
            if (!cancelled) setWaitlistOffers(next);
          })
          .catch(() => undefined);
      };
      const handle = InteractionManager.runAfterInteractions(poll);
      const intervalId = setInterval(poll, WAITLIST_OFFERS_POLL_MS);
      return () => {
        cancelled = true;
        handle.cancel();
        clearInterval(intervalId);
      };
    }, [token])
  );

  /** A freed-slot push can arrive while the customer is on a different screen — Home stays
   * mounted across drawer navigation, so this still fires and the card is already correct by the
   * time they come back. Mirrors NotificationsContext's same-event listener. */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PUSH_NOTIFICATION_RECEIVED_EVENT, (notification) => {
      const data = notification?.request?.content?.data as Record<string, unknown> | undefined;
      if (typeof data?.waitlistOfferId !== 'string' || !token) return;
      getPendingWaitlistOffers(token)
        .then(setWaitlistOffers)
        .catch(() => undefined);
    });
    return () => sub.remove();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    // navigation/index.tsx MainDrawer already calls prefetchCustomerTabData, prefetchAdminHeavyData,
    // and prefetchStaffDashboardData behind InteractionManager — calling them again here with
    // setTimeout(0) caused triple work during the screen transition. Only refresh appointments +
    // notifications here, and only after animations settle.
    const handle = InteractionManager.runAfterInteractions(() => {
      if (isPureCustomer) {
        // Background sync, not a user gesture — must never flip the shared `refreshing` flag that
        // other screens' pull-to-refresh spinners could be (or become) bound to.
        void refresh(token, { silent: true });
        void refreshNotifications(token);
      }
    });
    return () => handle.cancel();
  }, [token, isPureCustomer, refresh, refreshNotifications]);

  const handleAcceptWaitlistOffer = useCallback(
    async (offer: WaitlistSlotOffer) => {
      if (!token) return;
      const tempId = `temp-waitlist-${offer.id}`;
      const optimistic: AppointmentDto = {
        id: tempId,
        date: offer.date,
        time: offer.time,
        serviceName: offer.serviceName,
        staffName: offer.staffName,
        branchName: offer.branchName || '',
        serviceNameHe: offer.serviceNameHe,
        serviceNameAr: offer.serviceNameAr,
        branchNameHe: offer.branchNameHe || '',
        branchNameAr: offer.branchNameAr || '',
        price: 0,
        status: 'confirmed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setWaitlistOffers((prev) => prev.filter((o) => o.id !== offer.id));
      updateUpcoming((prev) =>
        [...prev, optimistic].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      );
      invalidate();

      try {
        const created = await acceptWaitlistOffer(offer.id, token);
        const dto: AppointmentDto = {
          id: created.id,
          date: created.date,
          time: created.time,
          serviceName: created.serviceName,
          staffName: created.staffName,
          branchName: created.branchName,
          serviceNameHe: created.serviceNameHe,
          serviceNameAr: created.serviceNameAr,
          branchNameHe: created.branchNameHe,
          branchNameAr: created.branchNameAr,
          price: created.price,
          status: 'confirmed',
          createdAt: created.createdAt,
          updatedAt: created.createdAt,
        };
        updateUpcoming((prev) => {
          const without = prev.filter((a) => a.id !== tempId && a.id !== dto.id);
          return [...without, dto].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        });
        const next = await getPendingWaitlistOffers(token);
        setWaitlistOffers(next);
        void forceRefresh(token);
      } catch (e) {
        try {
          const next = await getPendingWaitlistOffers(token);
          setWaitlistOffers(next);
        } catch {
          setWaitlistOffers((prev) =>
            prev.some((o) => o.id === offer.id) ? prev : [...prev, offer]
          );
        }
        updateUpcoming((prev) => prev.filter((a) => a.id !== tempId));
        alertWaitlistAcceptFailure(e);
      }
    },
    [token, invalidate, updateUpcoming, forceRefresh]
  );

  const hasAppointments = upcoming.length > 0;

  const handleCallBranch = () => {
    Linking.openURL(`tel:${shopBranch?.phone || BARBERSHOP_PHONE_INTL}`);
    setAppointmentMenuFor(null);
  };

  const handleNavigateBranch = () => {
    const branch = appointmentMenuFor?.branchName || shopBranch?.address || BARBERSHOP_MAP_QUERY;
    const url = appointmentMenuFor?.branchName
      ? `https://waze.com/ul?q=${encodeURIComponent(branch)}`
      : shopBranch?.wazeLink || `https://waze.com/ul?q=${encodeURIComponent(branch)}`;
    Linking.openURL(url);
    setAppointmentMenuFor(null);
  };

  const handleCancelAndNavigate = () => {
    const apt = appointmentMenuFor;
    setAppointmentMenuFor(null);
    if (apt?.id && token) {
      updateUpcoming((prev) => prev.filter((a) => a.id !== apt.id));
      cancelAppointment(apt.id, token).catch((e) => {
        updateUpcoming((prev) => [...prev, apt].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
        Alert.alert(t('common.error'), e instanceof Error ? e.message : t('home.cancelError'));
      });
    }
    navigation.navigate('Appointments');
  };

  const openProductWhatsApp = useCallback(
    (productName: string) => {
      const msg = t('productCard.inquiryMessage', { name: productName });
      Linking.openURL(buildProductInquiryWhatsAppUrl(msg, shopBranch?.phone));
    },
    [t, shopBranch],
  );

  /** Fixed MadarLabs (app builder) credit — not admin-editable, distinct from the shop's own Instagram. */
  const openMadarLabsInstagram = useCallback(() => {
    const deepLink = `instagram://user?username=${MADARLABS_INSTAGRAM_USERNAME}`;
    void Linking.canOpenURL(deepLink)
      .then((canOpen) => Linking.openURL(canOpen ? deepLink : MADARLABS_INSTAGRAM_URL))
      .catch(() => Linking.openURL(MADARLABS_INSTAGRAM_URL));
  }, []);

  const openShopInstagram = useCallback(() => {
    const url = shopBranch?.instagramUrl;
    if (!url) return;
    const username = url.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '');
    const deepLink = `instagram://user?username=${username}`;
    void Linking.canOpenURL(deepLink)
      .then((canOpen) => Linking.openURL(canOpen ? deepLink : url))
      .catch(() => Linking.openURL(url));
  }, [shopBranch]);

  const openContactPhone = useCallback(() => {
    void Linking.openURL(`tel:${shopBranch?.phone || MADARLABS_CONTACT_PHONE}`);
  }, [shopBranch]);

  const openWazeToSalon = useCallback(() => {
    if (shopBranch?.wazeLink) {
      void Linking.openURL(shopBranch.wazeLink);
      return;
    }
    const query = shopBranch?.address || BARBERSHOP_MAP_QUERY;
    void Linking.openURL(`https://waze.com/ul?q=${encodeURIComponent(query)}`);
  }, [shopBranch]);

  const toggleAbout = useCallback(() => setAboutFlipped((prev) => !prev), []);

  const renderCatalogProduct = useCallback(
    ({ item: product }: ListRenderItemInfo<CatalogProduct>) => {
      const hasRemoteImage = Boolean(product.imageUrl) && /^https?:\/\//i.test(product.imageUrl!);
      return (
        <View style={{ width: PRODUCT_CATALOG_CARD_WIDTH }}>
          <ProductCatalogCard
            product={product}
            imageUri={hasRemoteImage ? (product.imageUrl as string) : undefined}
            onCardPress={() => setProductDetailFor(product)}
          />
        </View>
      );
    },
    [],
  );

  return (
    <View style={styles.container}>
      <View style={styles.backgroundShape} />
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerSideStart}>
            <View style={styles.headerIconWrapper}>
              <ExpoImage source={icons.logo} style={styles.headerLogo} contentFit="contain" />
            </View>
          </View>
          <View style={styles.headerTitleFlex}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {BRAND_NAME}
            </Text>
          </View>
          <View style={styles.headerEnd}>
            <LanguageSwitcher variant="header" />
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => openDrawer(navigation)}
              accessibilityRole="button"
              accessibilityLabel={t('common.menuA11y')}
            >
              <Ionicons name="menu" size={26} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.contentWithVideo}>
        <View style={styles.videoSectionFixed}>
          <MemoDeferredHomeHero style={styles.videoPlayer} />
        </View>

        <View style={styles.scrollArea}>
          <ScrollView
            style={styles.scrollViewTransparent}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            <View style={{ flexGrow: 1 }}>
            <View style={styles.videoSpacer} />
            <View style={styles.homeMainSheet}>
              <Animated.View style={riseStyle}>
              <View style={[styles.welcomeTextWrap, hasAppointments && isLoggedIn && styles.welcomeWithApptBlock]}>
                {hasAppointments && isLoggedIn ? (
                  <>
                    <Text style={[styles.welcomeText, styles.welcomeTextLine1, styles.welcomeTitleWithAppt]}>
                      {t('home.hiBack', { name: user?.firstName || '' })}
                    </Text>
                    <Text style={[styles.welcomeSubtext, styles.welcomeSubtextWithAppt]}>
                      {t('home.dontForgetAppointment')}
                    </Text>
                  </>
                ) : isLoggedIn ? (
                  <Text style={styles.welcomeText}>{t('home.helloUser', { name: user?.firstName || '' })}</Text>
                ) : (
                  <Text style={styles.welcomeText}>{t('home.helloGuest')}</Text>
                )}
              </View>
              {isLoggedIn && waitlistOffers.length > 0 ? (
                <View style={styles.waitlistOffersBlock}>
                  {waitlistOffers.map((offer) => {
                    const dateLabel = formatDateDmy(new Date(`${offer.date}T12:00:00`));
                    return (
                      <View key={offer.id} style={styles.waitlistOfferCard}>
                        <Text style={styles.waitlistOfferTitle}>{t('home.waitlistSlotTitle')}</Text>
                        <Text style={styles.waitlistOfferBody}>
                          {pickLocalizedName({ nameHe: offer.serviceNameHe, nameAr: offer.serviceNameAr }, locale)} · {offer.staffName}
                          {'\n'}
                          {dateLabel} {t('home.atTime')} {offer.time}
                          {offer.branchName ? `\n${pickLocalizedName({ nameHe: offer.branchNameHe, nameAr: offer.branchNameAr }, locale)}` : ''}
                        </Text>
                        <Text style={styles.waitlistOfferHint}>{t('home.waitlistSlotHint')}</Text>
                        <TouchableOpacity
                          style={styles.waitlistOfferBtn}
                          onPress={() => handleAcceptWaitlistOffer(offer)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.waitlistOfferBtnText}>{t('home.waitlistConfirm')}</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {hasAppointments && isLoggedIn &&
                (upcoming.length === 1 ? (
                  <View style={styles.appointmentsSingleWrap}>
                    <View style={styles.appointmentCardShell}>
                    <AppointmentCard
                      item={upcoming[0]}
                      variant="carousel"
                      carouselSingle
                      onOptions={() => setAppointmentMenuFor(upcoming[0])}
                    />
                    </View>
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.appointmentsScrollContent}
                  >
                    {upcoming.map((apt) => (
                      <AppointmentCard
                        key={apt.id}
                        item={apt}
                        variant="carousel"
                        onOptions={() => setAppointmentMenuFor(apt)}
                      />
                    ))}
                  </ScrollView>
                ))}
              <TouchableOpacity
                style={styles.bookingCta}
                onPress={() => navigation.navigate(isLoggedIn ? 'Booking' : 'Login')}
                activeOpacity={0.88}
              >
                <Ionicons name="calendar-outline" size={18} color={colors.onPrimary} />
                <Text style={styles.bookingCtaText}>{isLoggedIn ? t('home.bookCta') : t('home.loginCta')}</Text>
              </TouchableOpacity>
              <MemoHomeContentSections
                aboutFlipped={aboutFlipped}
                onAboutPress={toggleAbout}
              />
              </Animated.View>
              {(catalogProducts.loading && catalogProducts.products.length === 0) || catalogProducts.products.length > 0 ? (
                <View style={homeStyles.productsShelf}>
                  <View style={homeStyles.productsSectionHeader}>
                    {catalogProducts.loading && catalogProducts.products.length === 0 ? (
                      <View style={homeStyles.productsLoadingRow}>
                        <ActivityIndicator size="small" color={colors.accent} />
                      </View>
                    ) : null}
                    <View style={homeStyles.productsTitleBlockPremium}>
                      <Text style={homeStyles.productsMasthead}>{t('home.productsTitle')}</Text>
                      <Text style={homeStyles.productsDeck}>{t('home.productsSubtitle')}</Text>
                    </View>
                  </View>
                  {catalogProducts.products.length > 0 ? (
                    <FlatList
                      data={catalogProducts.products}
                      horizontal
                      inverted
                      keyExtractor={(p) => p.id}
                      renderItem={renderCatalogProduct}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={homeStyles.productsFlatListContent}
                      nestedScrollEnabled
                      overScrollMode="never"
                      decelerationRate="fast"
                      initialNumToRender={3}
                      maxToRenderPerBatch={4}
                      windowSize={4}
                      removeClippedSubviews
                    />
                  ) : null}
                </View>
              ) : null}

              <View style={homeStyles.socialSection}>
                <Text style={homeStyles.socialTitle}>{t('home.followUs')}</Text>
                <View style={homeStyles.socialRow}>
                  <TouchableOpacity
                    style={homeStyles.socialBtn}
                    onPress={openShopInstagram}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.followUsInstagramA11y')}
                  >
                    <Ionicons name="logo-instagram" size={26} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={homeStyles.socialBtn}
                    onPress={openWazeToSalon}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.followUsLocationA11y')}
                  >
                    <Ionicons name="location-outline" size={26} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={homeStyles.socialBtn}
                    onPress={() => Linking.openURL(buildWhatsAppChatUrl(shopBranch?.phone))}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.followUsWhatsappA11y')}
                  >
                    <Ionicons name="logo-whatsapp" size={26} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <View style={homeStyles.contactBlock}>
                  <Text style={homeStyles.contactTitle}>{t('home.contactUsTitle')}</Text>
                  <TouchableOpacity
                    style={homeStyles.contactRow}
                    onPress={openContactPhone}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={shopBranch?.phone || MADARLABS_CONTACT_PHONE}
                  >
                    <View style={homeStyles.contactIconWrap}>
                      <Ionicons name="call-outline" size={18} color={colors.accent} />
                    </View>
                    <View style={homeStyles.contactTextWrap}>
                      <Text style={homeStyles.contactLabel}>{t('home.contactPhone')}</Text>
                      <Text style={homeStyles.contactValue}>{shopBranch?.phone || MADARLABS_CONTACT_PHONE}</Text>
                    </View>
                  </TouchableOpacity>
                  <View style={homeStyles.contactRow}>
                    <TouchableOpacity
                      style={homeStyles.contactIconWrap}
                      onPress={openWazeToSalon}
                      activeOpacity={0.82}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.wazeNavigateA11y')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="navigate-circle" size={20} color={colors.accent} />
                    </TouchableOpacity>
                    <View style={homeStyles.contactTextWrap}>
                      <Text style={homeStyles.contactLabel}>{t('home.contactLocation')}</Text>
                      <Text style={homeStyles.contactValueLocation}>{shopBranch?.address || BARBERSHOP_MAP_QUERY}</Text>
                      <View style={homeStyles.contactWazeHintRow}>
                        <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
                        <Text style={homeStyles.contactWazeHintText}>{t('home.contactWazeHint')}</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={homeStyles.madarLabsLineWrap}
                    onPress={openMadarLabsInstagram}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="MadrLabs"
                  >
                    <Text style={homeStyles.madarLabsLineText}>{t('home.madarLabsBuildLine')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={homeStyles.madarLabsInstagramRow}
                    onPress={openMadarLabsInstagram}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.madarLabsInstagramA11y')}
                  >
                    <Ionicons name="logo-instagram" size={16} color={colors.accent} />
                    <Text style={homeStyles.madarLabsInstagramText}>{t('home.madarLabsInstagramLabel')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            </View>
          </ScrollView>

          <MemoHomeNoticeBanner expanded={noticeExpanded} onDismiss={() => setNoticeExpanded(false)} />
        </View>
      </View>

      <HomeAppointmentModal
        appointment={appointmentMenuFor}
        onClose={() => setAppointmentMenuFor(null)}
        onCall={handleCallBranch}
        onNavigate={handleNavigateBranch}
        onCancel={handleCancelAndNavigate}
      />
      <ProductDetailSheet
        product={productDetailFor}
        imageUri={
          productDetailFor?.imageUrl && /^https?:\/\//i.test(productDetailFor.imageUrl)
            ? productDetailFor.imageUrl
            : undefined
        }
        onClose={() => setProductDetailFor(null)}
        onWhatsApp={() => {
          if (productDetailFor) openProductWhatsApp(pickLocalizedName(productDetailFor, locale));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backgroundShape: {
    position: 'absolute',
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.accent,
    opacity: 0.15,
  },
  contentWithVideo: { flex: 1, position: 'relative', backgroundColor: colors.surface },
  videoSectionFixed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: VIDEO_HEIGHT,
    zIndex: 0,
    overflow: 'hidden',
  },
  videoPlayer: { width: '100%', height: '100%' },
  /** Transparent scroll region — shows hero video underneath; keep tall enough that the clip stays visible */
  videoSpacer: { height: 180},
  scrollArea: { flex: 1, position: 'relative', zIndex: 1 },
  scrollViewTransparent: { flex: 1, backgroundColor: 'transparent' },
  header: {
    backgroundColor: colors.headerBg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  headerSideStart: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleFlex: {
    flex: 1,
  },
  headerEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    minWidth: 48,
  },
  headerIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.onHeader,
    letterSpacing: 2,
    textAlign: 'center',
  },
  menuButton: { padding: 8 },
  scrollContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: layout.screenPaddingBottom,
    flexGrow: 1,
  },
  welcomeTextWrap: { marginBottom: spacing.md, alignSelf: 'stretch' },
  /** Tighter stack: greeting → next appointment card */
  welcomeWithApptBlock: {
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  welcomeText: {
    ...textStyles.pageTitle,
    marginBottom: spacing.lg,
  },
  welcomeTextLine1: { marginBottom: 4 },
  welcomeTitleWithAppt: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    marginBottom: 2,
  },
  welcomeSubtext: {
    ...textStyles.bodyMedium,
    color: colors.textSecondary,
  },
  welcomeSubtextWithAppt: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  waitlistOffersBlock: { alignSelf: 'stretch', marginBottom: layout.sectionGap, gap: spacing.md },
  waitlistOfferCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent + '55',
  },
  waitlistOfferTitle: {
    ...textStyles.sectionTitle,
    fontSize: 17,
    marginBottom: spacing.sm,
  },
  waitlistOfferBody: {
    ...textStyles.body,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  waitlistOfferHint: {
    ...textStyles.caption,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  waitlistOfferBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  waitlistOfferBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
  appointmentsSingleWrap: { marginBottom: spacing.sm, alignSelf: 'stretch' },
  /** Slight inset so the card reads as one module with the greeting above */
  appointmentCardShell: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  appointmentsScrollContent: {
    paddingBottom: spacing.sm,
    paddingHorizontal: 0,
  },
  /**
   * Single scroll body under the hero video: welcome → stories → products → hero image → social.
   * Full-bleed vs scroll padding via negative horizontal margin; one surface so nothing feels “split”.
   */
  homeMainSheet: {
    backgroundColor: colors.surface,
    marginTop: 40,
    marginHorizontal: -layout.screenPaddingH,
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'stretch',
    ...shadows.card,
  },
  /** Compact pill CTA — not full width */
  bookingCta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg + 4,
    borderRadius: radius.full,
    /** Larger breathing room before stories section. */
    marginBottom: spacing.xl,
    maxWidth: '92%',
    ...shadows.card,
    shadowOpacity: 0.12,
    elevation: 4,
  },
  bookingCtaText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
});

const homeStyles = StyleSheet.create({
  noticeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
    overflow: 'visible',
  },
  noticeOverlayTouch: { width: '100%' },
  noticeCard: {
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  noticeTitle: { ...textStyles.sectionTitle, fontSize: 17, marginBottom: spacing.md },
  noticeBodyText: { ...textStyles.bodySmall, lineHeight: 24 },
  noticeCollapse: { alignItems: 'center', paddingTop: 16 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlayLight, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.surfaceMuted,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingBottom: layout.screenPaddingBottom,
    paddingHorizontal: layout.screenPaddingH,
    alignItems: 'stretch',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    alignSelf: 'center',
    marginBottom: 24,
  },
  modalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalBtnCancel: { backgroundColor: 'rgba(198, 40, 40, 0.08)' },
  modalBtnText: { fontSize: 16, fontWeight: '600', color: colors.text, marginRight: 10 },
  modalBtnTextCancel: { color: '#c62828' },
  productSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  productSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayLight,
  },
  productSheetCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '88%',
    overflow: 'hidden',
    ...shadows.sheet,
  },
  productSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  productSheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  productSheetClose: {
    padding: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
  },
  productSheetScroll: { maxHeight: 520 },
  productSheetScrollContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.md,
  },
  productSheetHero: {
    position: 'relative',
    marginHorizontal: -layout.screenPaddingH,
    marginBottom: spacing.md,
    minHeight: 300,
    height: 300,
    backgroundColor: colors.surfaceMuted,
    borderBottomStartRadius: radius.lg,
    borderBottomEndRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  productSheetSaleBadge: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.md,
    zIndex: 2,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201, 162, 39, 0.45)',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  productSheetSaleBadgeText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.accent,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  /** Full image visible (no aggressive crop) */
  productSheetHeroImgContain: {
    width: '100%',
    height: 276,
  },
  productSheetHeroImg: { width: '100%', height: '100%' },
  productSheetHeroEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  productSheetHeroEmptyText: {
    ...textStyles.caption,
    color: colors.textTertiary,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  productSheetStockBadge: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  productSheetStockBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  productSheetTitle: {
    ...textStyles.sectionTitle,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.sm,
    lineHeight: 28,
  },
  productSheetMetaRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  productSheetPriceCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  productSheetWasRow: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    gap: 4,
  },
  productSheetWasNum: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textMuted,
    textDecorationLine: 'line-through',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  productSheetWasShekel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    textDecorationLine: 'line-through',
    writingDirection: 'rtl',
  },
  productSheetPriceRow: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    gap: 4,
  },
  productSheetShekel: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.text,
    writingDirection: 'rtl',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  /** Sale row: same gold as list price, lighter weight (no red) */
  productSheetShekelSale: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '500',
  },
  productSheetPriceNum: {
    fontSize: 28,
    fontWeight: '500',
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: 'right',
    writingDirection: 'rtl',
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  productSheetPriceNumSale: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '500',
    letterSpacing: -0.3,
    fontVariant: Platform.OS === 'ios' ? ['tabular-nums'] : undefined,
  },
  productSheetMuted: { opacity: 0.45 },
  productSheetChip: {
    backgroundColor: colors.surfaceMuted,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  productSheetChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  productSheetHintRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  productSheetHint: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  productSheetSectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textTertiary,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.sm,
    letterSpacing: 0.4,
  },
  productSheetBody: {
    ...textStyles.body,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 24,
    color: colors.text,
  },
  productSheetBodyMuted: {
    ...textStyles.bodySmall,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 22,
    color: colors.textSecondary,
  },
  productSheetFooter: {
    paddingTop: spacing.sm,
    paddingHorizontal: layout.screenPaddingH,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  productSheetWa: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
    shadowOpacity: 0.1,
    elevation: 3,
  },
  productSheetWaText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  flipCardWrapper: {
    width: '100%',
    height: 220,
    marginTop: spacing.xxl + spacing.sm,
    marginBottom: spacing.md,
  },
  flipCardInner: { width: '100%', height: '100%', position: 'relative' as const },
  flipFace: { position: 'absolute', width: '100%', height: '100%', borderRadius: radius.lg, overflow: 'hidden' },
  flipFaceFront: { left: 0, top: 0, backgroundColor: colors.border },
  flipFaceBack: { left: 0, top: 0, padding: 18, justifyContent: 'center', backgroundColor: colors.surface },
  salonImage: { width: '100%', height: '100%' },
  aboutText: { ...textStyles.bodySmall, color: colors.text, lineHeight: 22, fontWeight: '600' },
  aboutButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg + 4,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    maxWidth: '88%',
    ...shadows.card,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
    marginBottom: spacing.xl,
  },
  aboutButtonText: {
    ...textStyles.bodyMedium,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
  },
  section: { marginBottom: layout.sectionGap },
  /** Full-bleed white band for the catalog rail (edge-to-edge under the curved home sheet). */
  productsShelf: {
    alignSelf: 'stretch',
    marginHorizontal: -layout.screenPaddingH,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: '#ffffff',
  },
  sectionTitle: {
    ...textStyles.pageTitle,
    fontSize: 20,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  productsSectionHeader: {
    marginBottom: spacing.md,
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: spacing.sm,
    borderBottomWidth: 0,
  },
  productsLoadingRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.sm,
  },
  /** Centered masthead — aligns visually with «עקבו אחרינו» below */
  productsTitleBlockPremium: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  productsMasthead: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    writingDirection: 'rtl',
    color: colors.text,
    lineHeight: 28,
    letterSpacing: 0.2,
    marginBottom: spacing.sm,
  },
  productsDeck: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
    writingDirection: 'rtl',
    lineHeight: 20,
    maxWidth: 340,
    alignSelf: 'center',
  },
  productsScroll: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: 0,
  },
  /**
   * Horizontal shelf RTL: `inverted` on the FlatList (same pattern as Home stories rail).
   * Use `row` here — `row-reverse` on VirtualizedList content is unreliable and kept first tile on the wrong edge.
   */
  productsFlatListContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md,
    paddingHorizontal: layout.screenPaddingH,
    backgroundColor: '#ffffff',
    gap: PRODUCT_CATALOG_SHELF_GAP,
  },
  socialSection: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.lg },
  socialTitle: {
    ...textStyles.pageTitle,
    fontSize: 20,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, marginBottom: spacing.md },
  socialBtn: { padding: 10 },
  contactBlock: {
    marginTop: spacing.md,
    width: '100%',
    maxWidth: 360,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  contactTitle: {
    ...textStyles.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.xs,
  },
  /**
   * RTL: `row-reverse` + icon first in JSX → icon on the visual right, text block to its left (same order as reference).
   */
  contactRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  contactIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactTextWrap: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  contactLabel: {
    ...textStyles.caption,
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  contactValue: {
    ...textStyles.bodyMedium,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'ltr',
    marginTop: 2,
  },
  contactValueLocation: {
    ...textStyles.bodyMedium,
    color: colors.text,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 2,
  },
  /** Hint under location — Waze opens only from the icon button, not this text. */
  contactWazeHintRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: spacing.xs,
  },
  contactWazeHintText: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  madarLabsLineWrap: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    alignSelf: 'stretch',
  },
  madarLabsLineText: {
    ...textStyles.bodySmall,
    color: colors.textSecondary,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 21,
  },
  madarLabsInstagramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'stretch',
  },
  madarLabsInstagramText: {
    ...textStyles.bodySmall,
    color: colors.text,
    fontWeight: '600',
  },
  ratingLink: { color: colors.accent, fontWeight: '600', textDecorationLine: 'underline' },
});
