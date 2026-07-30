import { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager, type ViewStyle } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Asset } from 'expo-asset';
import { createDrawerNavigator, type DrawerContentComponentProps } from '@react-navigation/drawer';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { VerifyOtpScreen } from '../screens/auth/VerifyOtpScreen';
import { HomeScreen } from '../screens/customer/HomeScreen';
import { BookingScreen } from '../screens/customer/BookingScreen';
import { TeamScreen } from '../screens/customer/TeamScreen';
import { AppointmentsScreen } from '../screens/customer/AppointmentsScreen';
import { DashboardScreen } from '../screens/admin/DashboardScreen';
import { AdminScreen } from '../screens/admin/AdminScreen';
import { AdminStaffScheduleScreen } from '../screens/admin/AdminStaffScheduleScreen';
import { AdminProductsScreen } from '../screens/admin/AdminProductsScreen';
import { AdminCustomersScreen } from '../screens/admin/AdminCustomersScreen';
import { AdminCustomerDetailsScreen } from '../screens/admin/AdminCustomerDetailsScreen';
import { StaffDashboardScreen } from '../screens/staff/StaffDashboardScreen';
import { StaffWorkingHoursScreen } from '../screens/staff/StaffWorkingHoursScreen';
import { StaffBlockedTimesScreen } from '../screens/staff/StaffBlockedTimesScreen';
import { AdminBlockedTimesScreen } from '../screens/admin/AdminBlockedTimesScreen';
import { StaffAppointmentsScreen } from '../screens/staff/StaffAppointmentsScreen';
import { StaffWaitlistScreen } from '../screens/staff/StaffWaitlistScreen';
import { AdminWaitlistScreen } from '../screens/admin/AdminWaitlistScreen';
import { StaffPerformanceReportScreen } from '../screens/shared/StaffPerformanceReportScreen';
import { AdminStaffReportHubScreen } from '../screens/admin/AdminStaffReportHubScreen';
import { HomeStoriesManageScreen } from '../screens/shared/HomeStoriesManageScreen';
import { NotificationsScreen } from '../screens/customer/NotificationsScreen';
import { ProfileScreen } from '../screens/customer/ProfileScreen';
import { SettingsScreen } from '../screens/customer/SettingsScreen';
import { DirectionsScreen } from '../screens/customer/DirectionsScreen';
import { DrawerContent } from '../components/navigation/DrawerContent';
import { useAuth } from '../hooks/useAuth';
import { restoreAuth, setAuth } from '../store/auth.store';
import { setOn401 } from '../services/api.on401';
import { prefetchCustomerTabData } from '../services/customerPrefetchCache';
import { prefetchStaffDashboardData } from '../services/staffPrefetchCache';
import { prefetchAdminHeavyData } from '../services/adminPrefetchCache';
import { LegalDocumentScreen } from '../screens/customer/LegalDocumentScreen';
import { AboutAppScreen } from '../screens/customer/AboutAppScreen';
import type { RootDrawerParamList } from './paramList';
import { colors } from '../theme';
import { home } from '../utils/assets';

/** Param list for the root Stack (wraps the Drawer). */
type RootStackParamList = {
  Main: undefined;
};

export type { RootDrawerParamList };

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<RootDrawerParamList>();

const hidden = { drawerItemStyle: { display: 'none' as const } };

/** Stable drawer chrome — avoids new `screenOptions` objects every MainDrawer render (reduces navigator work during open/close). */
const drawerScreenOptions = {
  drawerPosition: 'right' as const,
  /** `front` = drawer slides over the current screen (scene stays put). `slide` moves the whole scene and often feels laggy / “reload”. */
  drawerType: 'front' as const,
  overlayColor: 'rgba(0,0,0,0.35)',
  /** Opaque panel avoids subpixel flicker between overlay and drawer during animation. */
  drawerStyle: { width: '75%', backgroundColor: colors.surface } satisfies ViewStyle,
  headerShown: false,
  swipeEnabled: true,
  sceneContainerStyle: { backgroundColor: colors.background } satisfies ViewStyle,
};

function MainDrawer() {
  const { token, isRestored, isPureCustomer, hasStaffProfile, isAdmin } = useAuth();

  const renderDrawerContent = useCallback(
    (props: DrawerContentComponentProps) => <DrawerContent {...props} />,
    [],
  );

  /** Defer prefetches so opening the drawer / screen transitions stay on the UI thread first. */
  useEffect(() => {
    if (!isRestored || !token) return;
    // All three prefetches now run after interactions — previously prefetchCustomerTabData
    // fired immediately (no InteractionManager) causing a reconciliation burst during the
    // drawer slide animation on every navigation.
    const handle = InteractionManager.runAfterInteractions(() => {
      if (isPureCustomer) void prefetchCustomerTabData(token);
      if (hasStaffProfile) void prefetchStaffDashboardData(token);
      if (isAdmin) void prefetchAdminHeavyData(token);
    });
    return () => handle.cancel();
  }, [isRestored, token, isPureCustomer, hasStaffProfile, isAdmin]);

  return (
    <Drawer.Navigator
      // @ts-ignore TypedNavigator<ParamList> omits DrawerNavigationConfig (drawerContent) - RN 7 types
      drawerContent={renderDrawerContent}
      screenOptions={drawerScreenOptions}
      initialRouteName="Home"
      /** Avoid iOS native-stack + drawer leaving OTP success visually stuck after `reset` to Home. */
      detachInactiveScreens={true}
    >
      <Drawer.Screen name="Home" component={HomeScreen} />
      <Drawer.Screen name="Team" component={TeamScreen} />
      <Drawer.Screen name="Directions" component={DirectionsScreen} />
      <Drawer.Screen name="Booking" component={BookingScreen} />
      <Drawer.Screen name="Appointments" component={AppointmentsScreen} />
      <Drawer.Screen name="Profile" component={ProfileScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
      <Drawer.Screen name="Notifications" component={NotificationsScreen} options={hidden} />
      <Drawer.Screen name="Dashboard" component={DashboardScreen} options={hidden} />
      <Drawer.Screen name="StaffDashboard" component={StaffDashboardScreen} options={hidden} />
      <Drawer.Screen name="StaffWorkingHours" component={StaffWorkingHoursScreen} options={hidden} />
      <Drawer.Screen name="StaffBlockedTimes" component={StaffBlockedTimesScreen} options={hidden} />
      <Drawer.Screen name="AdminBlockedTimes" component={AdminBlockedTimesScreen} options={hidden} />
      <Drawer.Screen name="StaffAppointments" component={StaffAppointmentsScreen} options={hidden} />
      <Drawer.Screen name="StaffWaitlist" component={StaffWaitlistScreen} options={hidden} />
      <Drawer.Screen name="Admin" component={AdminScreen} options={hidden} />
      <Drawer.Screen name="AdminStaffSchedule" component={AdminStaffScheduleScreen} options={hidden} />
      <Drawer.Screen name="AdminProducts" component={AdminProductsScreen} options={hidden} />
      <Drawer.Screen name="AdminCustomers" component={AdminCustomersScreen} options={hidden} />
      <Drawer.Screen name="AdminCustomerDetails" component={AdminCustomerDetailsScreen} options={hidden} />
      <Drawer.Screen name="AdminWaitlist" component={AdminWaitlistScreen} options={hidden} />
      <Drawer.Screen name="AdminStaffReport" component={StaffPerformanceReportScreen} options={hidden} />
      <Drawer.Screen name="AdminStaffReportHub" component={AdminStaffReportHubScreen} options={hidden} />
      <Drawer.Screen name="StaffReport" component={StaffPerformanceReportScreen} options={hidden} />
      <Drawer.Screen
        name="StaffStories"
        component={HomeStoriesManageScreen}
        initialParams={{ variant: 'staff' }}
        options={hidden}
      />
      <Drawer.Screen
        name="AdminStories"
        component={HomeStoriesManageScreen}
        initialParams={{ variant: 'admin' }}
        options={hidden}
      />
      <Drawer.Screen name="Login" component={LoginScreen} options={hidden} />
      <Drawer.Screen name="Register" component={RegisterScreen} options={hidden} />
      <Drawer.Screen name="VerifyOtp" component={VerifyOtpScreen} options={hidden} />
      <Drawer.Screen name="LegalDocument" component={LegalDocumentScreen} options={hidden} />
      <Drawer.Screen name="AboutApp" component={AboutAppScreen} options={hidden} />
    </Drawer.Navigator>
  );
}

export function RootNavigator() {
  const { isRestored } = useAuth();
  const splashHiddenRef = useRef(false);

  useEffect(() => {
    setOn401(() => setAuth(null, null));
    void restoreAuth();
  }, []);

  /** Warm first Home open by preloading hero media at app startup. */
  useEffect(() => {
    void Asset.fromModule(home.video)
      .downloadAsync()
      .catch(() => {});
    void Asset.fromModule(home.hero)
      .downloadAsync()
      .catch(() => {});
  }, []);

  /** Hide native splash only after auth + disk caches are ready, then after first UI commit (smoother than instant pop). */
  useEffect(() => {
    if (!isRestored || splashHiddenRef.current) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      splashHiddenRef.current = true;
      void SplashScreen.hideAsync().catch(() => {});
    });
    return () => handle.cancel();
  }, [isRestored]);

  const stackScreenOptions = useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: colors.background },
      animation: 'fade' as const,
      animationDuration: 220,
    }),
    [],
  );

  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="Main" component={MainDrawer} />
    </Stack.Navigator>
  );
}
