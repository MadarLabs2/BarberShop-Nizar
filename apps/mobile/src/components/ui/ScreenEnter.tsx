import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  LAYOUT_EASE_OUT_SMOOTH,
  SCREEN_ENTER_MS,
  SCREEN_ENTER_RISE_FROM_Y,
} from '../../theme/motion';
import { useScreenEnterEpoch } from '../../hooks/useScreenEnterEpoch';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  replayOnFocus?: boolean;
  remountKey?: string | number;
  variant?: 'fade' | 'rise';
  durationMs?: number;
  /** Override rise distance in px — used by BookingScreen and TeamScreen */
  riseFromY?: number;
};

export function ScreenEnter({
  children,
  style,
  replayOnFocus = false,
  remountKey,
  variant = 'fade',
  durationMs,
  riseFromY,
}: Props) {
  const epoch = useScreenEnterEpoch(replayOnFocus);
  const reducedMotion = useReducedMotion();
  const ms = durationMs ?? SCREEN_ENTER_MS;
  const rise = riseFromY ?? SCREEN_ENTER_RISE_FROM_Y;

  // Reduce Motion on: skip the fade/rise entirely — content just appears, no undefined-then-visible
  // animation duration (a near-instant fade still reads as "motion" to Reduce Motion users).
  const entering = reducedMotion
    ? undefined
    : variant === 'rise'
      ? FadeInDown.duration(ms)
          .easing(LAYOUT_EASE_OUT_SMOOTH)
          .withInitialValues({ transform: [{ translateY: rise }] })
      : FadeIn.duration(ms).easing(LAYOUT_EASE_OUT_SMOOTH);

  const remountSegment =
    remountKey !== undefined && remountKey !== null ? String(remountKey) : '';
  const mountKey = replayOnFocus
    ? `screen-enter-${epoch}${remountSegment ? `-${remountSegment}` : ''}`
    : remountSegment
      ? `screen-enter-${remountSegment}`
      : 'screen-enter';

  return (
    <Animated.View key={mountKey} entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
