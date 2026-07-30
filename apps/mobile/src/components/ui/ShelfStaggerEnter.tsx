import React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  HOME_SHELF_EASING,
  HOME_SHELF_ROW_FADE_MS,
  HOME_SHELF_STAGGER_MAX_MS,
  HOME_SHELF_STAGGER_MS,
} from '../../theme/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Snappy variant for home stories rail */
const SNAPPY_ROW_MS = Platform.OS === 'android' ? 130 : 160;
const SNAPPY_STAGGER_MS = 28;
const SNAPPY_STAGGER_MAX_MS = 180;

/** How far each card rises from below as it fades in */
const RISE_FROM_Y = Platform.OS === 'android' ? 10 : 14;

type Props = {
  index: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  snappy?: boolean;
};

/**
 * Staggered fade+rise entrance for list cards, shelf items, notification cards.
 * Each item slides up from RISE_FROM_Y pixels below and fades in, with a delay
 * based on its index — creates a professional cascading "waterfall" entrance.
 */
export function ShelfStaggerEnter({ index, children, style, snappy }: Props) {
  const reducedMotion = useReducedMotion();
  const duration = snappy ? SNAPPY_ROW_MS : HOME_SHELF_ROW_FADE_MS;
  const stagger = snappy ? SNAPPY_STAGGER_MS : HOME_SHELF_STAGGER_MS;
  const staggerMax = snappy ? SNAPPY_STAGGER_MAX_MS : HOME_SHELF_STAGGER_MAX_MS;
  const delay = Math.min(index * stagger, staggerMax);

  // Reduce Motion on: every row just appears — no cascading fade/rise (a per-row waterfall of
  // motion across a whole list is exactly what this OS setting asks apps to avoid).
  const entering = reducedMotion
    ? undefined
    : FadeInDown
        .duration(duration)
        .delay(delay)
        .easing(HOME_SHELF_EASING)
        .withInitialValues({ transform: [{ translateY: RISE_FROM_Y }] });

  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
