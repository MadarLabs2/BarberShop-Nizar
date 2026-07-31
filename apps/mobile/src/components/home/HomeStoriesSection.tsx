import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Dimensions,
  FlatList,
  ListRenderItemInfo,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, cancelAnimation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { PRODUCT_CATALOG_SHELF_GAP } from '../../components/cards/ProductCatalogCard';
import { fetchHomeStories, markHomeStoryViewed, type HomeStoryAuthor, type HomeStoryItem } from '../../services/stories.api';
import {
  HOME_STORIES_API_SILENCE_MS,
  getPublicHomeStoriesMemoryCacheSync,
  prefetchImageUrlOnce,
  readPublicHomeStoriesCacheWithAge,
  scheduleStaggeredRailStoryPrefetches,
  warmPublicStoriesImages,
  writePublicHomeStoriesCache,
} from '../../services/homeStoriesCache';
import {
  HOME_STORY_DELETED_EVENT,
  HOME_STORY_UPLOADED_EVENT,
  mergeHomeStoryIntoAuthors,
  mergePendingUploadsIntoServer,
  pendingPayloadFromUpload,
  removeStoryIdFromAuthors,
  type HomeStoryUploadedPayload,
} from '../../lib/homeStoriesUploadEvents';
import { colors, radius, spacing, textStyles } from '../../theme';
import { useAuth } from '../../hooks/useAuth';

const WIN = Dimensions.get('window');
const SCR = Dimensions.get('screen');
const WIN_W = WIN.width;
const WIN_H = WIN.height;
/** Full physical screen — story viewer fills edge-to-edge (no letterboxing from window vs screen). */
const SCREEN_W = SCR.width;
const SCREEN_H = SCR.height;

/** Portrait tile width — tall cards like reference apps */
const STORY_CARD_W = Math.min(132, Math.round(WIN_W * 0.34));
const STORY_CARD_H = Math.round((STORY_CARD_W * 16) / 9);
const STORY_CARD_RADIUS = radius.lg + 4;
const AVATAR_ON_CARD = 44;
const AVATAR_BORDER = 3;
/** Rail tile — snappier feedback before the full-screen viewer opens. */
const TIMING_IN = { duration: 90, easing: Easing.out(Easing.cubic) };
const TIMING_OUT = { duration: 150, easing: Easing.out(Easing.cubic) };
/** Full-screen viewer — short so the photo feels "there" quickly, with a soft settle. */
const VIEWER_REVEAL_MS = 135;
const VIEWER_REVEAL = { duration: VIEWER_REVEAL_MS, easing: Easing.out(Easing.cubic) };
const STORY_AUTO_ADVANCE_MS = 5000;

let homeStoriesAnonViewerSeq = 0;

type ViewerState = {
  items: StoryRailEntry[];
  page: number;
} | null;

/** One rail tile per uploaded photo (not grouped per staff). */
type StoryRailEntry = {
  story: HomeStoryItem;
  authorKey: string;
  authorTitle: string;
  avatarUrl: string | null;
  kind: HomeStoryAuthor['kind'];
};

function flattenStoriesForRail(authors: HomeStoryAuthor[], t: (k: string) => string): StoryRailEntry[] {
  const items: StoryRailEntry[] = [];
  for (const a of authors) {
    const authorTitle = resolveAuthorDisplayName(a, t);
    const avatarUrl = a.avatarUrl ?? null;
    const kind = a.kind;
    for (const story of a.stories) {
      items.push({ story, authorKey: a.authorKey, authorTitle, avatarUrl, kind });
    }
  }
  items.sort((x, y) => new Date(y.story.createdAt).getTime() - new Date(x.story.createdAt).getTime());
  return items;
}

function formatRelativeStoryTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 45) return t('stories.timeJustNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('stories.timeAgoMinutes', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('stories.timeAgoHours', { count: h });
  const d = Math.floor(h / 24);
  if (d < 14) return t('stories.timeAgoDays', { count: d });
  const w = Math.floor(d / 7);
  return t('stories.timeAgoWeeks', { count: Math.max(1, w) });
}

function resolveAuthorDisplayName(a: HomeStoryAuthor, t: (k: string) => string): string {
  if (a.kind === 'salon') return t('home.storiesSalonName');
  const n = (a.displayName || '').trim();
  return n || t('home.storiesStaffFallback');
}

function StoriesRailHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.titleBlockPremium}>
        <View style={styles.storiesEyebrowRow}>
          <View style={styles.storiesEyebrowRule} />
          <Text style={styles.storiesEyebrow}>{kicker}</Text>
          <View style={styles.storiesEyebrowRule} />
        </View>
        <Text style={styles.storiesMasthead}>{title}</Text>
      </View>
    </View>
  );
}

export function HomeStoriesSection() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [authors, setAuthors] = useState<HomeStoryAuthor[]>(() => {
    // Synchronous memory cache read — stories appear instantly on revisit with zero async work.
    const pack = getPublicHomeStoriesMemoryCacheSync();
    return pack ? mergePendingUploadsIntoServer(pack.authors, []) : [];
  });
  const [loading, setLoading] = useState(() => {
    const pack = getPublicHomeStoriesMemoryCacheSync();
    return !(pack && pack.authors.length > 0);
  });
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState>(null);
  const pendingUploadsRef = useRef<HomeStoryUploadedPayload[]>([]);
  const viewedStoryIdsRef = useRef(new Set<string>());
  const anonViewerKeyRef = useRef(`viewer-anon-${++homeStoriesAnonViewerSeq}`);

  const load = useCallback(async (opts?: { hydrateFromCache?: boolean }) => {
    let hydratedCache = false;
    let skipNetworkAfterWarmHit = false;
    if (opts?.hydrateFromCache) {
      const pack = await readPublicHomeStoriesCacheWithAge();
      if (pack && pack.authors.length > 0) {
        hydratedCache = true;
        setAuthors(mergePendingUploadsIntoServer(pack.authors, pendingUploadsRef.current));
        warmPublicStoriesImages(pack.authors);
        setError(null);
        setLoading(false);
        // Cache is fresh enough — skip the network call entirely this session.
        if (Date.now() - pack.cacheAt < HOME_STORIES_API_SILENCE_MS) {
          skipNetworkAfterWarmHit = true;
        }
      }
    }
    if (skipNetworkAfterWarmHit) return;

    if (!hydratedCache) setLoading(true);
    setError(null);
    try {
      const data = await fetchHomeStories();
      const server = data.authors ?? [];
      const serverIds = new Set(server.flatMap((a) => a.stories.map((s) => s.id)));
      pendingUploadsRef.current = pendingUploadsRef.current.filter((p) => !serverIds.has(p.story.id));
      const nextAuthors = mergePendingUploadsIntoServer(server, pendingUploadsRef.current);
      setAuthors(nextAuthors);
      warmPublicStoriesImages(nextAuthors);
      void writePublicHomeStoriesCache(server);
    } catch {
      if (!hydratedCache) setError(t('home.storiesLoadError'));
      if (!hydratedCache) setAuthors([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // No InteractionManager needed here: useState initializer already reads from sync memory cache,
  // so authors/loading are correct on first render. load() only touches network if cache is stale.
  useEffect(() => {
    void load({ hydrateFromCache: true });
  }, [load]);

  useEffect(() => {
    const subUp = DeviceEventEmitter.addListener(
      HOME_STORY_UPLOADED_EVENT,
      (payload: HomeStoryUploadedPayload) => {
        const replaceTempId = payload.replaceTempId;
        const pending = pendingPayloadFromUpload(payload);
        if (replaceTempId) {
          pendingUploadsRef.current = pendingUploadsRef.current.filter(
            (p) => p.story.id !== replaceTempId && p.story.id !== pending.story.id,
          );
        } else {
          pendingUploadsRef.current = pendingUploadsRef.current.filter((p) => p.story.id !== pending.story.id);
        }
        pendingUploadsRef.current.push(pending);

        setAuthors((prev) => {
          const base = replaceTempId
            ? removeStoryIdFromAuthors(prev, replaceTempId)
            : prev;
          return mergeHomeStoryIntoAuthors(base, pending);
        });
        setError(null);
      },
    );
    const subDel = DeviceEventEmitter.addListener(
      HOME_STORY_DELETED_EVENT,
      ({ id }: { id: string }) => {
        pendingUploadsRef.current = pendingUploadsRef.current.filter((p) => p.story.id !== id);
        setAuthors((prev) => removeStoryIdFromAuthors(prev, id));
      },
    );
    return () => {
      subUp.remove();
      subDel.remove();
    };
  }, []);

  const railItems = useMemo(() => flattenStoriesForRail(authors, t), [authors, t]);

  const railItemsRef = useRef(railItems);
  railItemsRef.current = railItems;

  const railViewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 32, minimumViewTime: 90 }),
    [],
  );

  const onRailViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const items = railItemsRef.current;
      if (items.length === 0) return;
      const expanded = new Set<number>();
      for (const vi of viewableItems) {
        const i = vi.index;
        if (typeof i !== 'number' || i < 0 || i >= items.length) continue;
        expanded.add(i);
        if (i > 0) expanded.add(i - 1);
        if (i < items.length - 1) expanded.add(i + 1);
      }
      if (expanded.size === 0) return;
      scheduleStaggeredRailStoryPrefetches(items, [...expanded]);
    },
    [],
  );

  /** Lead tiles match initialNumToRender; rest prefetch after interactions in small batches. */
  useEffect(() => {
    if (railItems.length === 0) return;
    const lead = Array.from({ length: Math.min(6, railItems.length) }, (_, i) => i);
    scheduleStaggeredRailStoryPrefetches(railItems, lead);
  }, [railItems]);

  const openSingleStory = useCallback((entry: StoryRailEntry) => {
    if (railItems.length === 0) return;
    const startIndex = railItems.findIndex((item) => item.story.id === entry.story.id);
    prefetchImageUrlOnce(entry.story.imageUrl);
    if (startIndex > 0) prefetchImageUrlOnce(railItems[startIndex - 1]?.story.imageUrl);
    if (startIndex >= 0 && startIndex < railItems.length - 1) {
      prefetchImageUrlOnce(railItems[startIndex + 1]?.story.imageUrl);
    }
    setViewer({
      items: railItems,
      page: startIndex >= 0 ? startIndex : 0,
    });
  }, [railItems]);

  const renderStoryRailItem = useCallback(
    ({ item: entry }: ListRenderItemInfo<StoryRailEntry>) => {
      return (
        <View
          style={{
            width: STORY_CARD_W + spacing.sm,
            alignItems: 'center',
          }}
        >
          <StoryPortraitCard
            storyId={entry.story.id}
            imageUrl={entry.story.imageUrl}
            label={entry.authorTitle}
            avatarUrl={entry.avatarUrl}
            kind={entry.kind}
            onPress={() => openSingleStory(entry)}
          />
        </View>
      );
    },
    [openSingleStory],
  );

  const closeViewer = useCallback(() => setViewer(null), []);

  const viewerEntry = viewer?.items[viewer.page];
  const viewerStory = viewerEntry?.story;
  const viewerTime = viewerStory ? formatRelativeStoryTime(viewerStory.createdAt, t) : '';
  const viewerViewsLabel = viewerStory ? t('stories.viewsCount', { count: Math.max(0, Number(viewerStory.viewsCount || 0)) }) : '';

  useEffect(() => {
    if (!viewerStory) return;
    if (viewedStoryIdsRef.current.has(viewerStory.id)) return;
    viewedStoryIdsRef.current.add(viewerStory.id);

    const viewerKey = anonViewerKeyRef.current;
    void markHomeStoryViewed(viewerStory.id, { token, viewerKey })
      .then((res) => {
        setAuthors((prev) =>
          prev.map((author) => ({
            ...author,
            stories: author.stories.map((s) =>
              s.id === viewerStory.id ? { ...s, viewsCount: res.viewsCount } : s,
            ),
          })),
        );
      })
      .catch(() => {
        // non-blocking analytics; viewer must stay smooth even if this call fails
      });
  }, [viewerStory, token]);

  const sectionTitle = useMemo(() => t('home.galleryTitle'), [t]);

  if (loading) {
    return (
      <View style={styles.section} accessibilityLabel={t('home.storiesLoading')}>
        <StoriesRailHeader kicker={t('home.storiesKicker')} title={sectionTitle} />
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error || railItems.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <StoriesRailHeader kicker={t('home.storiesKicker')} title={sectionTitle} />

      <FlatList
        data={railItems}
        horizontal
        inverted
        keyExtractor={(e) => e.story.id}
        renderItem={renderStoryRailItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storiesFlatListContent}
        nestedScrollEnabled
        overScrollMode="never"
        decelerationRate="fast"
        initialNumToRender={6}
        maxToRenderPerBatch={10}
        windowSize={7}
        viewabilityConfig={railViewabilityConfig}
        onViewableItemsChanged={onRailViewableItemsChanged}
      />

      <Modal
        visible={!!viewer}
        animationType="none"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={closeViewer}
      >
        {viewer && viewerStory ? (
          <StoryViewerBody
            viewer={viewer}
            viewerEntry={viewerEntry}
            viewerStory={viewerStory}
            viewerTime={viewerTime}
            viewerViewsLabel={viewerViewsLabel}
            insets={insets}
            closeViewer={closeViewer}
            setViewer={setViewer}
            t={t}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function StoryViewerBody({
  viewer,
  viewerEntry,
  viewerStory,
  viewerTime,
  viewerViewsLabel,
  insets,
  closeViewer,
  setViewer,
  t,
}: {
  viewer: NonNullable<ViewerState>;
  viewerEntry: StoryRailEntry;
  viewerStory: HomeStoryItem;
  viewerTime: string;
  viewerViewsLabel: string;
  insets: { top: number; bottom: number };
  closeViewer: () => void;
  setViewer: React.Dispatch<React.SetStateAction<ViewerState>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  /** Instant dismiss on swipe-down — no on-screen drag (avoids janky motion). */
  const dismissArmedRef = useRef(false);
  const pausedRef = useRef(false);
  const segmentProgress = useSharedValue(0);
  const reveal = useSharedValue(0);

  useEffect(() => {
    dismissArmedRef.current = false;
  }, [viewerStory.id]);

  useEffect(() => {
    reveal.value = 0;
    reveal.value = withTiming(1, VIEWER_REVEAL);
  }, [viewerStory.id]);

  useEffect(() => {
    prefetchImageUrlOnce(viewer.items[viewer.page]?.story.imageUrl);
    prefetchImageUrlOnce(viewer.items[viewer.page - 1]?.story.imageUrl);
    prefetchImageUrlOnce(viewer.items[viewer.page + 1]?.story.imageUrl);
  }, [viewer.items, viewer.page]);

  const goNextStory = useCallback(() => {
    setViewer((v) => {
      if (!v) return v;
      if (v.page >= v.items.length - 1) {
        closeViewer();
        return v;
      }
      return { ...v, page: v.page + 1 };
    });
  }, [closeViewer, setViewer]);

  const startStoryProgress = useCallback(
    (durationMs: number) => {
      segmentProgress.value = withTiming(
        1,
        { duration: durationMs, easing: Easing.linear },
        (finished) => {
          if (finished) runOnJS(goNextStory)();
        },
      );
    },
    [goNextStory, segmentProgress],
  );

  const pauseStoryProgress = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    cancelAnimation(segmentProgress);
  }, [segmentProgress]);

  const resumeStoryProgress = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    const current = Math.max(0, Math.min(1, segmentProgress.value));
    const remaining = Math.max(180, Math.round((1 - current) * STORY_AUTO_ADVANCE_MS));
    startStoryProgress(remaining);
  }, [segmentProgress, startStoryProgress]);

  useEffect(() => {
    pausedRef.current = false;
    segmentProgress.value = 0;
    startStoryProgress(STORY_AUTO_ADVANCE_MS);
    return () => {
      cancelAnimation(segmentProgress);
    };
  }, [viewer.page, viewer.items.length, segmentProgress, startStoryProgress]);

  const activeSegmentFillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, segmentProgress.value)) * 100}%`,
  }));

  const viewerRevealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [
      {
        translateY: interpolate(reveal.value, [0, 1], [14, 0]),
      },
      {
        scale: interpolate(reveal.value, [0, 1], [1.03, 1]),
      },
    ],
  }));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.05,
        onPanResponderMove: (_e, g) => {
          if (dismissArmedRef.current) return;
          if (g.dy > 56 && Math.abs(g.dy) > Math.abs(g.dx)) {
            dismissArmedRef.current = true;
            closeViewer();
          }
        },
        onPanResponderRelease: (_e, g) => {
          if (dismissArmedRef.current) return;
          if (g.dy > 72 || g.vy > 800) {
            dismissArmedRef.current = true;
            closeViewer();
          }
        },
        onPanResponderTerminate: (_e, g) => {
          if (dismissArmedRef.current) return;
          if (g.dy > 72 || g.vy > 800) {
            dismissArmedRef.current = true;
            closeViewer();
          }
        },
      }),
    [closeViewer],
  );

  return (
    <View style={styles.viewerRoot} {...panResponder.panHandlers}>
      <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
      <Animated.View
        style={[styles.viewerMediaLayer, { width: SCREEN_W, height: SCREEN_H }, viewerRevealStyle]}
      >
      <ExpoImage
        recyclingKey={viewerStory.id}
        source={{ uri: viewerStory.imageUrl }}
        style={[StyleSheet.absoluteFill, { width: SCREEN_W, height: SCREEN_H }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />

      <LinearGradient
        colors={['rgba(0,0,0,0.88)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.04)', 'transparent']}
        locations={[0, 0.34, 0.72, 1]}
        style={[styles.viewerTopScrim, { paddingTop: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <View style={styles.segmentRow} pointerEvents="none">
          <View style={styles.segmentBar}>
            <Animated.View
              style={[
                styles.segmentBarFill,
                activeSegmentFillStyle,
              ]}
            />
          </View>
        </View>

        <View style={styles.viewerHeaderRow}>
          <Pressable
            onPress={closeViewer}
            style={({ pressed }) => [styles.viewerClose, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>

          <View style={styles.viewerMeta}>
            <View style={styles.viewerAvatarWrap}>
              {viewerEntry.avatarUrl ? (
                <ExpoImage
                  recyclingKey={`${viewerStory.id}-viewer-avatar`}
                  source={{ uri: viewerEntry.avatarUrl }}
                  style={styles.viewerAvatarImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              ) : viewerEntry.kind === 'salon' ? (
                <View style={styles.viewerAvatarSalon}>
                  <Ionicons name="cut" size={18} color={colors.accent} />
                </View>
              ) : (
                <View style={styles.viewerAvatarPlaceholder}>
                  <Ionicons name="person" size={18} color={colors.textTertiary} />
                </View>
              )}
            </View>
            <View style={styles.viewerTextCol}>
              <Text style={styles.viewerName} numberOfLines={1}>
                {viewerEntry.authorTitle}
              </Text>
              <View style={styles.viewerMetaSubRow}>
                {viewerTime ? (
                  <Text style={styles.viewerTime} numberOfLines={1}>
                    {viewerTime}
                  </Text>
                ) : null}
                <View style={styles.viewerViewsWrap}>
                  <Ionicons name="eye-outline" size={13} color="rgba(255,255,255,0.8)" />
                  <Text style={styles.viewerViewsText} numberOfLines={1}>
                    {viewerViewsLabel}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </LinearGradient>

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.45)']}
        style={styles.viewerBottomScrim}
        pointerEvents="none"
      />
      </Animated.View>

      <View style={styles.viewerTapZones} pointerEvents="box-none">
        <Pressable
          style={styles.tapLeft}
          onPressIn={pauseStoryProgress}
          onPressOut={resumeStoryProgress}
          onPress={() =>
            setViewer((v) => {
              if (!v || v.page >= v.items.length - 1) {
                closeViewer();
                return v;
              }
              return { ...v, page: v.page + 1 };
            })
          }
        />
        <Pressable
          style={styles.tapRight}
          onPressIn={pauseStoryProgress}
          onPressOut={resumeStoryProgress}
          onPress={() =>
            setViewer((v) => {
              if (!v || v.page <= 0) return v;
              return { ...v, page: v.page - 1 };
            })
          }
        />
      </View>

    </View>
  );
}

function StoryPortraitCard({
  storyId,
  imageUrl,
  label,
  avatarUrl,
  kind,
  onPress,
}: {
  storyId: string;
  imageUrl: string;
  label: string;
  avatarUrl: string | null;
  kind: HomeStoryAuthor['kind'];
  onPress: () => void;
}) {
  const pressed = useSharedValue(0);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const t = pressed.value;
    // Android: animating elevation/shadow every frame forces a native shadow recompute per
    // frame (expensive, unlike iOS's compositor-cheap layer shadows) — real jank risk on
    // mid-range hardware. Keep the scale feedback; hold shadow/elevation at their resting
    // values on Android instead of interpolating them. iOS keeps the original animated shadow.
    if (Platform.OS === 'android') {
      return {
        transform: [{ scale: interpolate(t, [0, 1], [1, 0.978]) }],
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      };
    }
    return {
      transform: [{ scale: interpolate(t, [0, 1], [1, 0.978]) }],
      shadowOpacity: interpolate(t, [0, 1], [0.08, 0.15]),
      shadowRadius: interpolate(t, [0, 1], [16, 22]),
      shadowOffset: { width: 0, height: interpolate(t, [0, 1], [4, 9]) },
      elevation: interpolate(t, [0, 1], [6, 10]),
    };
  });

  const heroZoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 1.045]) }],
  }));

  const onPressIn = useCallback(() => {
    prefetchImageUrlOnce(imageUrl);
    pressed.value = withTiming(1, TIMING_IN);
  }, [imageUrl, pressed]);

  const onPressOut = useCallback(() => {
    pressed.value = withTiming(0, TIMING_OUT);
  }, [pressed]);

  return (
    <View style={styles.cardShell}>
      <View style={styles.storyEnteringShell}>
        <Animated.View style={[styles.storyCardWrap, cardAnimatedStyle]}>
          <Pressable
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            style={styles.cardPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            android_ripple={{ color: 'rgba(201, 162, 39, 0.14)', foreground: true }}
          >
            <View style={styles.cardFrame}>
              <Animated.View style={[styles.cardImageClip, heroZoomStyle]}>
                <ExpoImage
                  recyclingKey={storyId}
                  source={{ uri: imageUrl }}
                  style={styles.cardImageInner}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              </Animated.View>
              <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0.72)']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={styles.avatarOnCard}>
                {avatarUrl ? (
                  <ExpoImage
                    recyclingKey={`${storyId}-avatar`}
                    source={{ uri: avatarUrl }}
                    style={styles.avatarOnCardImg}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={0}
                  />
                ) : kind === 'salon' ? (
                  <View style={styles.avatarSalonInner}>
                    <Ionicons name="cut" size={20} color={colors.accent} />
                  </View>
                ) : (
                  <View style={styles.avatarStaffInner}>
                    <Ionicons name="person" size={20} color={colors.textTertiary} />
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    alignSelf: 'stretch',
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 0,
  },
  titleBlockPremium: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  storiesEyebrowRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  storiesEyebrowRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    maxWidth: 56,
  },
  storiesEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    textAlign: 'center',
    writingDirection: 'rtl',
    letterSpacing: 1,
  },
  storiesMasthead: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    writingDirection: 'rtl',
    letterSpacing: 0.2,
    lineHeight: 28,
  },
  loadingRow: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  storiesFlatListContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: 0,
    backgroundColor: '#ffffff',
    gap: PRODUCT_CATALOG_SHELF_GAP,
  },
  cardShell: {
    alignItems: 'center',
    width: STORY_CARD_W + spacing.sm,
  },
  storyEnteringShell: {
    alignSelf: 'center',
  },
  storyCardWrap: {
    width: STORY_CARD_W,
    borderRadius: STORY_CARD_RADIUS,
    backgroundColor: colors.surfaceMuted,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  },
  cardPress: {
    width: STORY_CARD_W,
  },
  cardFrame: {
    width: STORY_CARD_W,
    height: STORY_CARD_H,
    borderRadius: STORY_CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  cardImageClip: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  cardImageInner: {
    width: '100%',
    height: '100%',
  },
  avatarOnCard: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    width: AVATAR_ON_CARD,
    height: AVATAR_ON_CARD,
    borderRadius: AVATAR_ON_CARD / 2,
    borderWidth: AVATAR_BORDER,
    borderColor: '#fff',
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOnCardImg: {
    width: '100%',
    height: '100%',
  },
  avatarSalonInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  avatarStaffInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  cardName: {
    ...textStyles.caption,
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.sm + 2,
    textAlign: 'center',
    maxWidth: STORY_CARD_W + 8,
    writingDirection: 'rtl',
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerMediaLayer: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    zIndex: 0,
    backgroundColor: colors.surfaceMuted,
  },
  viewerTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    zIndex: 2,
  },
  segmentRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginBottom: spacing.sm,
  },
  segmentBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  segmentBarFill: {
    height: '100%',
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 2,
  },
  viewerHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewerClose: {
    padding: spacing.sm,
    marginStart: -spacing.xs,
  },
  viewerMeta: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    marginEnd: spacing.xs,
  },
  viewerAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
    backgroundColor: '#222',
  },
  viewerAvatarImg: {
    width: '100%',
    height: '100%',
  },
  viewerAvatarSalon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  viewerAvatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
  },
  viewerTextCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  viewerName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  viewerTime: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  viewerMetaSubRow: {
    marginTop: 2,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
  },
  viewerViewsWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 2,
    paddingHorizontal: spacing.xs + 2,
    borderRadius: radius.full,
  },
  viewerViewsText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  viewerBottomScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN_H * 0.22,
    zIndex: 1,
  },
  viewerTapZones: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    zIndex: 4,
  },
  tapLeft: {
    flex: 1,
  },
  tapRight: {
    flex: 1,
  },
});
