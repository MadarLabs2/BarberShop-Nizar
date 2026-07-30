import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let cached: boolean | null = null;

/**
 * Tracks the OS-level "Reduce Motion" accessibility setting (iOS Settings > Accessibility >
 * Motion; Android Settings > Accessibility > Remove animations). Nothing in this app checked
 * this before — every entrance/press/skeleton animation ran unconditionally regardless of it.
 * Shared primitives (ScalePressable, ScreenEnter, ShelfStaggerEnter) read this to skip movement
 * for users who've asked the OS not to show it, while still giving instant visual feedback.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(cached ?? false);

  useEffect(() => {
    let mounted = true;
    if (cached === null) {
      AccessibilityInfo.isReduceMotionEnabled().then((value) => {
        cached = value;
        if (mounted) setReduced(value);
      });
    }
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      cached = value;
      if (mounted) setReduced(value);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/** Non-hook read for worklets/module-level code — may be stale until the first hook mount populates it. */
export function getReducedMotionSnapshot(): boolean {
  return cached ?? false;
}
