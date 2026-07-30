import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { enableFreeze } from 'react-native-screens';
import { NavigationContainer, DefaultTheme, type Theme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import './src/i18n';
import { LocaleProvider } from './src/contexts/LocaleContext';
import { RootNavigator } from './src/navigation';
import { navigationRef } from './src/navigation/navigationRef';
import { DrawerMenuSnapshotBridge } from './src/navigation/DrawerMenuSnapshotBridge';
import { AppointmentsProvider } from './src/contexts/AppointmentsContext';
import { NotificationsProvider } from './src/contexts/NotificationsContext';
import { BadgeSeenProvider } from './src/contexts/BadgeSeenContext';
import { colors } from './src/theme';
import { consumeInitialPushResponse, ensurePushInfrastructure } from './src/services/push';

/**
 * `enableFreeze(true)` + drawer transitions on iOS can leave the previous scene visibly stuck
 * until a system overlay (Control Center / home indicator area) forces a native repaint.
 * See react-native-screens issues around frozen scenes / drawer.
 */
enableFreeze(false);

const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.background,
  },
};

function App() {
  useEffect(() => {
    void SplashScreen.preventAutoHideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    ensurePushInfrastructure();
  }, []);

  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          onReady={() => {
            void consumeInitialPushResponse();
          }}
        >
          <BadgeSeenProvider>
            <AppointmentsProvider>
              <NotificationsProvider>
                <DrawerMenuSnapshotBridge />
                <StatusBar style="light" />
                <RootNavigator />
              </NotificationsProvider>
            </AppointmentsProvider>
          </BadgeSeenProvider>
        </NavigationContainer>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}

export default App;
