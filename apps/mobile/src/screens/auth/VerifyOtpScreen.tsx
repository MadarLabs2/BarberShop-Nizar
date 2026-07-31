import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  Linking,
  Alert,
  Platform,
  I18nManager,
  Keyboard,
} from 'react-native';
import { useRoute, useNavigation, CommonActions } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import type { RootDrawerParamList } from '../../navigation/paramList';
import { navigationRef } from '../../navigation/navigationRef';
import { getAuthState } from '../../store/auth.store';
import { prefetchCustomerTabData } from '../../services/customerPrefetchCache';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { isValidPhone, isValidOtpCode } from '../../utils/validators';
import { colors, radius, spacing, layout, textStyles, iconSize } from '../../theme';
import { BARBERSHOP_PHONE_INTL } from '../../lib/config';
import { AppButton } from '../../components/ui/AppButton';

type RouteParams = {
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  otpCodeLength?: number;
  resendAvailableAt?: string;
};

export function VerifyOtpScreen() {
  const { t } = useTranslation();
  const route = useRoute();
  const navigation = useNavigation<DrawerNavigationProp<RootDrawerParamList>>();
  /** Stable handle for post-OTP navigation — `navigation` identity changes across renders and was clearing the 2s timer via effect cleanup. */
  const drawerNavRef = useRef(navigation);
  drawerNavRef.current = navigation;
  const params = (route.params || {}) as RouteParams;
  const phoneNumber = params.phoneNumber || '';

  useEffect(() => {
    if (!phoneNumber?.trim()) navigation.goBack();
  }, [phoneNumber, navigation]);

  const { requestOtp, verifyOtp, isLoading } = useAuth();
  const initialLen = params.otpCodeLength ?? 6;
  const [step, setStep] = useState<'verify' | 'success'>('verify');
  const [otpLen, setOtpLen] = useState(initialLen);
  const [code, setCode] = useState<string[]>(() => Array(initialLen).fill(''));
  const [error, setError] = useState('');
  const [resendUntilMs, setResendUntilMs] = useState<number | null>(() =>
    params.resendAvailableAt ? new Date(params.resendAvailableAt).getTime() : null,
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** Single field for paste + iOS SMS autofill; digits mirrored into `code` cells. */
  const hiddenOtpRef = useRef<TextInput>(null);

  const resendSecondsLeft =
    resendUntilMs != null ? Math.max(0, Math.ceil((resendUntilMs - nowTick) / 1000)) : 0;

  useEffect(() => {
    if (resendUntilMs == null) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendUntilMs]);

  useEffect(() => {
    const focusTimer = setTimeout(() => hiddenOtpRef.current?.focus(), 120);
    return () => clearTimeout(focusTimer);
  }, [otpLen]);

  useEffect(() => {
    if (step !== 'success') return;
    let cancelled = false;

    const goHome = () => {
      if (cancelled) return;
      const drawer = drawerNavRef.current;

      /** Prefer one root `reset` so native layer fully swaps Main→Drawer state (avoids “stuck” OTP frame on iOS). */
      if (navigationRef.isReady()) {
        try {
          navigationRef.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [
                {
                  name: 'Main',
                  state: {
                    index: 0,
                    routes: [{ name: 'Home' }],
                  },
                },
              ],
            } as never),
          );
          return;
        } catch {
          /* fall through */
        }
      }

      try {
        drawer.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Home' }],
          }),
        );
      } catch {
        try {
          drawer.navigate('Home');
        } catch {
          /* ignore */
        }
      }
    };

    const navTimer = setTimeout(goHome, 2000);
    return () => {
      cancelled = true;
      clearTimeout(navTimer);
    };
    /** Intentionally omit `navigation`: it changes identity often and was cancelling this timer before 2s. */
  }, [step]);

  const sendOtpToPhone = useCallback(async (): Promise<boolean> => {
    if (!phoneNumber?.trim()) {
      setError(t('verifyOtp.missingPhone'));
      return false;
    }
    if (!isValidPhone(phoneNumber)) {
      setError(t('verifyOtp.invalidPhoneRetry'));
      return false;
    }
    setError('');
    try {
      const res = await requestOtp(phoneNumber);
      setOtpLen(res.otpCodeLength);
      setCode(Array(res.otpCodeLength).fill(''));
      setResendUntilMs(new Date(res.resendAvailableAt).getTime());
      setNowTick(Date.now());
      if (res.devCode) {
        Alert.alert(t('verifyOtp.devCodeTitle'), res.devCode);
      }
      return true;
    } catch (e) {
      const err = e as Error & { resendAvailableAt?: string; httpStatus?: number };
      if (err.httpStatus === 429 && err.resendAvailableAt) {
        const until = new Date(err.resendAvailableAt).getTime();
        setResendUntilMs(until);
        setNowTick(Date.now());
        setError('');
      } else {
        const raw = e instanceof Error ? e.message : t('verifyOtp.sendCodeError');
        if (raw.includes('SMS_SEND_FAILED')) {
          setError(t('verifyOtp.otpSendFailed'));
        } else if (raw.includes('OTP_DB_INSERT_FAILED')) {
          setError(`${raw}\n${t('verifyOtp.otpDbInsertFailedHint')}`);
        } else {
          const friendly = /network|request failed|fetch|failed to fetch/i.test(raw)
            ? t('common.networkError')
            : raw;
          setError(friendly);
        }
      }
      return false;
    }
  }, [phoneNumber, requestOtp, t]);

  useEffect(() => {
    if (params.resendAvailableAt) return;
    if (!phoneNumber?.trim() || !isValidPhone(phoneNumber)) return;
    void sendOtpToPhone();
  }, [params.resendAvailableAt, phoneNumber, sendOtpToPhone]);

  const handleResendCode = async () => {
    if (resendSecondsLeft > 0) return;
    await sendOtpToPhone();
  };

  const applyOtpDigits = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, otpLen);
    const newCode = Array(otpLen).fill('');
    for (let i = 0; i < digits.length; i++) newCode[i] = digits[i];
    setCode(newCode);
    setError('');
  };

  const handleHiddenOtpChange = (text: string) => {
    applyOtpDigits(text);
  };

  const handleVerify = async () => {
    const codeStr = code.join('');
    if (!isValidOtpCode(codeStr, otpLen) || !phoneNumber) return;
    setError('');
    const reg =
      params.firstName?.trim() && params.lastName?.trim()
        ? {
            firstName: params.firstName.trim(),
            lastName: params.lastName.trim(),
            ...(params.birthDate ? { birthDate: params.birthDate } : {}),
          }
        : undefined;
    const { success, error: err } = await verifyOtp(phoneNumber, codeStr, reg);
    if (success) {
      Keyboard.dismiss();
      hiddenOtpRef.current?.blur();
      const { token } = getAuthState();
      if (token) void prefetchCustomerTabData(token);
      setStep('success');
    } else {
      setError(err || t('verifyOtp.invalidCode'));
    }
  };

  const openSalonContact = () => {
    Linking.openURL(`tel:${BARBERSHOP_PHONE_INTL.replace(/\s/g, '')}`);
  };

  if (!phoneNumber?.trim()) return null;

  if (step === 'success') {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successHeader}>
          <Text style={styles.successHeaderTitle}>{t('verifyOtp.successHeaderTitle')}</Text>
        </View>
        <View style={styles.successContent}>
          <View style={styles.successCircle}>
            <Ionicons name="checkmark" size={56} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>{t('verifyOtp.successTitle')}</Text>
          <Text style={styles.successSubtitle}>{t('verifyOtp.successSubtitle')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.backA11y')}
        >
          <Ionicons
            name={I18nManager.isRTL ? 'arrow-forward' : 'arrow-back'}
            size={iconSize.lg}
            color={colors.onHeader}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('verifyOtp.headerTitle')}</Text>
        <View style={styles.menuButton} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={52} color={colors.accent} />
        </View>

        <Text style={styles.title}>
          {params.firstName ? t('verifyOtp.titleRegister') : t('verifyOtp.titleEnterCode')}
        </Text>
        <Text style={styles.subtitle}>
          {t('verifyOtp.subtitleCodeSent', { phone: phoneNumber })}
          {params.firstName ? t('verifyOtp.subtitleAfterRegister') : ''}
        </Text>

        <View style={styles.otpLtrWrapper}>
          <Pressable
            style={styles.otpPressable}
            onPress={() => hiddenOtpRef.current?.focus()}
            accessibilityRole="none"
          >
            <View style={styles.codeContainer} pointerEvents="none">
              {code.map((digit, index) => (
                <View key={index} style={styles.otpCell}>
                  <Text style={styles.otpCellText} maxFontSizeMultiplier={2}>
                    {digit}
                  </Text>
                </View>
              ))}
            </View>
            <TextInput
              ref={hiddenOtpRef}
              style={styles.hiddenOtpInput}
              value={code.join('')}
              onChangeText={handleHiddenOtpChange}
              keyboardType="number-pad"
              maxLength={otpLen}
              textAlign="center"
              caretHidden
              autoCorrect={false}
              spellCheck={false}
              textContentType="oneTimeCode"
              {...(Platform.OS === 'android'
                ? ({ autoComplete: 'sms-otp', importantForAutofill: 'yes' } as const)
                : {})}
              accessibilityLabel={t('verifyOtp.titleEnterCode')}
            />
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <AppButton
          title={t('verifyOtp.verifyAndLogin')}
          onPress={handleVerify}
          disabled={!isValidOtpCode(code.join(''), otpLen) || isLoading}
          loading={isLoading}
          style={styles.verifyBtn}
        />

        <TouchableOpacity
          style={[styles.secondaryButton, resendSecondsLeft > 0 && styles.buttonDisabled]}
          onPress={handleResendCode}
          disabled={isLoading || resendSecondsLeft > 0}
        >
          <Text style={styles.secondaryButtonText}>
            {resendSecondsLeft > 0
              ? t('verifyOtp.cooldown', { seconds: resendSecondsLeft })
              : t('verifyOtp.requestNewCode')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.helpLink} onPress={openSalonContact}>
          <Text style={styles.helpLinkText}>{t('verifyOtp.helpContact')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.headerBg,
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
    paddingBottom: spacing.md,
    paddingHorizontal: layout.screenPaddingH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  backButton: { padding: spacing.sm, minWidth: layout.hitMin, minHeight: layout.hitMin, justifyContent: 'center' },
  headerTitle: {
    ...textStyles.navTitle,
    flex: 1,
  },
  menuButton: { width: 40 },
  content: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.xl,
    paddingBottom: layout.screenPaddingBottom,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...textStyles.pageTitle,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: spacing.sm,
    writingDirection: 'rtl',
  },
  subtitle: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.lg,
    writingDirection: 'rtl',
  },
  errorText: {
    ...textStyles.bodySmall,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  /** LTR island: OTP order must not mirror with app RTL. */
  otpLtrWrapper: {
    alignSelf: 'stretch',
    direction: 'ltr',
  },
  otpPressable: {
    position: 'relative',
    alignSelf: 'center',
    minHeight: 52,
    marginBottom: spacing.lg,
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  otpCell: {
    width: 52,
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpCellText: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  /** Covers cells; receives tap, paste, and iOS SMS autofill. */
  hiddenOtpInput: {
    ...StyleSheet.absoluteFill,
    opacity: Platform.OS === 'ios' ? 0.02 : 0.04,
    color: colors.text,
    fontSize: 18,
  },
  verifyBtn: {
    alignSelf: 'stretch',
  },
  secondaryButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    ...textStyles.bodySmall,
    marginTop: 0,
  },
  helpLink: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  helpLinkText: {
    ...textStyles.caption,
    color: colors.accent,
    fontWeight: '600',
    textAlign: 'center',
  },
  successContainer: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  successHeader: {
    backgroundColor: colors.headerBg,
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
    paddingBottom: spacing.md,
    paddingHorizontal: layout.screenPaddingH,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    alignItems: 'center',
  },
  successHeaderTitle: {
    ...textStyles.navTitle,
  },
  successContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: colors.success,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  successTitle: {
    ...textStyles.pageTitle,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  successSubtitle: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    lineHeight: 24,
  },
});
