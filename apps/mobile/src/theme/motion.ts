import { Platform } from 'react-native';
import { Easing } from 'react-native-reanimated';

/**
 * Smooth ease-out — feels natural and settled, not mechanical.
 * Used for all enter/exit animations across the app.
 */
export const LAYOUT_EASE_OUT_SMOOTH = Easing.bezier(0.25, 0.1, 0.25, 1);

/**
 * Full-screen enter duration.
 * Android is slightly shorter — matches perceived smoothness of iOS.
 */
export const SCREEN_ENTER_MS = Platform.OS === 'android' ? 380 : 460;

/** Rise distance on screen enter — smaller on Android for proportion. */
export const SCREEN_ENTER_RISE_FROM_Y = Platform.OS === 'android' ? 10 : 16;

/** Team screen gallery enter */
export const TEAM_SCREEN_ENTER_MS = Platform.OS === 'android' ? 320 : 400;
export const TEAM_SCREEN_ENTER_RISE_FROM_Y = Platform.OS === 'android' ? 8 : 12;

/** Shelf row/card stagger fade+rise */
export const HOME_SHELF_FADE_MS = Platform.OS === 'android' ? 340 : 420;
export const HOME_SHELF_EASING = LAYOUT_EASE_OUT_SMOOTH;
export const HOME_SHELF_STAGGER_MS = 45;
export const HOME_SHELF_STAGGER_MAX_MS = 320;
export const HOME_SHELF_ROW_FADE_MS = Platform.OS === 'android' ? 320 : 400;
