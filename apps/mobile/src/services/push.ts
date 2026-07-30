import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform, DeviceEventEmitter } from 'react-native';
import { deletePushToken, registerPushToken } from './push.api';
import { navigationRef } from '../navigation/navigationRef';
import type { RootDrawerParamList } from '../navigation/paramList';
import { refreshAuthUser } from '../store/auth.store';

const EXPO_PUSH_LAST_KEY = 'expo_push_token_last_registered_v1';

let handlersConfigured = false;
let responseListenerAttached = false;

/** Emitted when a push notification arrives (foreground). NotificationsContext subscribes to invalidate cache. */
export const PUSH_NOTIFICATION_RECEIVED_EVENT = 'pushNotificationReceived';

/** Mirrors Settings «קבלת התראות» — when false, no banners/sounds (foreground) and we clear tray/scheduled locals. */
let userWantsPushDelivery = true;

export function setUserWantsPushDelivery(wants: boolean): void {
  userWantsPushDelivery = wants;
}

export function getUserWantsPushDelivery(): boolean {
  return userWantsPushDelivery;
}

/** Best-effort: remove delivered notifications and cancel app-scheduled ones when user turns off in-app alerts. */
export async function clearLocalNotificationPresentation(): Promise<void> {
  if (isExpoGo()) return;
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* ignore */
  }
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* ignore */
  }
}

/** Resets the OS app-icon badge count to 0 (e.g. after a permanent delete-all). Does not touch push registration. */
export async function resetAppIconBadge(): Promise<void> {
  if (isExpoGo()) return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    /* ignore */
  }
}

function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
}

function resolveDrawerScreen(raw: unknown): keyof RootDrawerParamList {
  if (raw === 'Appointments' || raw === 'Notifications' || raw === 'Home' || raw === 'Booking') {
    return raw;
  }
  return 'Notifications';
}

function navigateFromPushData(data: Record<string, unknown> | undefined): void {
  if (!navigationRef.isReady()) return;
  const screen = resolveDrawerScreen(data?.screen);
  const waitlistOfferId =
    typeof data?.waitlistOfferId === 'string' ? data.waitlistOfferId : undefined;

  if (screen === 'Booking' && waitlistOfferId) {
    navigationRef.dispatch(
      CommonActions.navigate({
        name: 'Main',
        params: { screen: 'Booking', params: { waitlistOfferId } },
      } as never),
    );
    return;
  }

  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: { screen, params: undefined },
    } as never),
  );
}

/** Idempotent: foreground behavior, Android channel, tap listener. */
export function ensurePushInfrastructure(): void {
  if (isExpoGo()) return;
  if (!handlersConfigured) {
    handlersConfigured = true;
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data as Record<string, unknown> | undefined;
        if (data?.type === 'permission_updated') {
          // Silent data-only wake-up (no title/body was ever sent) — refresh the session right
          // now and never present anything for it: not a real notification, always suppressed
          // regardless of the user's notification preference, never touches the notifications list.
          void refreshAuthUser();
          return {
            shouldShowAlert: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: false,
            shouldShowList: false,
          };
        }
        // Emit event so NotificationsContext invalidates its cache — new notification appears
        // without the user needing to manually pull-to-refresh.
        DeviceEventEmitter.emit(PUSH_NOTIFICATION_RECEIVED_EVENT, notification);
        if (!getUserWantsPushDelivery()) {
          return {
            shouldShowAlert: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: false,
            shouldShowList: false,
          };
        }
        return {
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      },
    });
    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  }
  if (!responseListenerAttached) {
    responseListenerAttached = true;
    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromPushData(data);
    });
  }
}

/** Deactivates this device’s Expo token on the server (or all tokens if no local token). */
export async function deactivateDevicePushOnServer(authToken: string): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(EXPO_PUSH_LAST_KEY);
    if (saved) {
      await deletePushToken(authToken, saved);
    } else {
      await deletePushToken(authToken);
    }
  } catch {
    /* non-fatal */
  } finally {
    try {
      await AsyncStorage.removeItem(EXPO_PUSH_LAST_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Registers Expo push token with API when permissions allow (development / production builds; not Expo Go for FCM).
 */
export async function syncPushRegistration(opts: { authToken: string; enabled: boolean }): Promise<void> {
  if (isExpoGo()) return;
  ensurePushInfrastructure();
  if (!opts.enabled) {
    await deactivateDevicePushOnServer(opts.authToken);
    return;
  }
  if (!Device.isDevice) return;

  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
    Constants.easConfig?.projectId;
  if (!projectId || typeof projectId !== 'string') {
    return;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') return;

  const expo = await Notifications.getExpoPushTokenAsync({ projectId });
  const expoPushToken = expo.data;
  if (!expoPushToken) return;

  await registerPushToken(opts.authToken, expoPushToken, Platform.OS);
  await AsyncStorage.setItem(EXPO_PUSH_LAST_KEY, expoPushToken);
}

/** Opens the right screen when the app was opened from a killed state via a notification tap. */
export async function consumeInitialPushResponse(): Promise<void> {
  if (isExpoGo()) return;
  const last = await Notifications.getLastNotificationResponseAsync();
  if (!last) return;
  const data = last.notification.request.content.data as Record<string, unknown> | undefined;
  navigateFromPushData(data);
}
