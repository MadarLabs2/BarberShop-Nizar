/**
 * ScalePressable — drop-in for TouchableOpacity with native-thread scale feedback.
 * Runs on the UI thread via Reanimated — zero JS involvement during animation.
 */
import React, { useCallback } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const SCALE_PRESSED = 0.95;
const PRESS_IN_MS = 75;
const SPRING = { damping: 18, stiffness: 300, mass: 0.55 };

export interface ScalePressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
  accessibilityRole?: 'button' | 'link' | 'none';
  accessibilityLabel?: string;
  android_ripple?: { color?: string; borderless?: boolean; foreground?: boolean } | null;
}

export function ScalePressable({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  hitSlop,
  accessibilityRole = 'button',
  accessibilityLabel,
  android_ripple,
}: ScalePressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePressIn = useCallback(() => {
    // Reduce Motion on: still confirm the tap registered, but with an instant opacity dip
    // instead of a scale/movement animation.
    if (reducedMotion) {
      opacity.value = 0.7;
      return;
    }
    scale.value = withTiming(SCALE_PRESSED, {
      duration: PRESS_IN_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [scale, opacity, reducedMotion]);

  const handlePressOut = useCallback(() => {
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    scale.value = withSpring(1, SPRING);
  }, [scale, opacity, reducedMotion]);

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      android_ripple={android_ripple}
    >
      <Animated.View style={[animatedStyle, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
