import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Increments whenever this screen regains focus after having been blurred (user left the tab/screen).
 * Lets keyed children remount and replay Reanimated `entering` on every re-entry, without double-firing on first mount.
 */
export function useScreenEnterEpoch(enabled: boolean): number {
  const [epoch, setEpoch] = useState(0);
  const hadBlur = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      if (hadBlur.current) {
        setEpoch((e) => e + 1);
      }
      return () => {
        hadBlur.current = true;
      };
    }, [enabled]),
  );

  return epoch;
}
