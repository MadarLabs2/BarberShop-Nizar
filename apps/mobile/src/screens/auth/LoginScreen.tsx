import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppInput } from '../../components/ui/AppInput';
import { AppButton } from '../../components/ui/AppButton';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { useAuth } from '../../hooks/useAuth';
import { isValidPhone } from '../../utils/validators';
import { openDrawer } from '../../utils/nav';
import { colors, shadows, radius, spacing, layout, textStyles, iconSize } from '../../theme';

export function LoginScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (name: string) => void; openDrawer?: () => void }>();
  const { checkRegistered, requestOtp, isLoading } = useAuth();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    if (!isValidPhone(phone)) {
      setError(t('auth.invalidPhone'));
      return;
    }
    try {
      const registered = await checkRegistered(phone);
      if (!registered) {
        Alert.alert(
          t('auth.notRegisteredTitle'),
          t('auth.notRegisteredMsg'),
          [
            { text: t('common.ok') },
            { text: t('auth.registerNow'), onPress: () => (navigation.navigate as (s: string) => void)('Register') },
          ]
        );
        return;
      }
      const otpRes = await requestOtp(phone);
      if (otpRes.devCode) {
        Alert.alert(t('verifyOtp.devCodeTitle'), otpRes.devCode);
      }
      (navigation.navigate as (s: string, p?: object) => void)('VerifyOtp', {
        phoneNumber: phone,
        otpCodeLength: otpRes.otpCodeLength,
        resendAvailableAt: otpRes.resendAvailableAt,
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : t('auth.fetchError');
      if (raw.includes('SMS_SEND_FAILED')) {
        setError(t('verifyOtp.otpSendFailed'));
        return;
      }
      if (raw.includes('OTP_DB_INSERT_FAILED')) {
        setError(`${raw}\n${t('verifyOtp.otpDbInsertFailedHint')}`);
        return;
      }
      const friendly = /network|request failed|fetch|failed to fetch/i.test(raw) ? t('common.networkError') : raw;
      setError(friendly);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
    >
      <BlackHeader title={t('auth.loginTitle')} onMenuPress={() => openDrawer(navigation)} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="call" size={iconSize.xl} color={colors.accent} />
          </View>
          <Text style={styles.title}>{t('auth.welcomeBack')}</Text>
          <Text style={styles.subtitle}>{t('auth.enterPhone')}</Text>
          <AppInput
            placeholder={t('auth.phonePlaceholder')}
            accessibilityLabel={t('auth.phoneLabelA11y')}
            required
            value={phone}
            onChangeText={(t) => {
              setPhone(t);
              setError('');
            }}
            keyboardType="phone-pad"
            maxLength={10}
            textAlign="center"
            style={styles.input}
            errorMessage={error || undefined}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {phone.length >= 9 && (
            <AppButton title={t('auth.loginSubmit')} onPress={handleLogin} loading={isLoading} style={styles.primaryButton} />
          )}
          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => (navigation.navigate as (s: string) => void)('Register')}
          >
            <Text style={styles.registerText}>
              {t('auth.notRegisteredLine')}{' '}
              <Text style={styles.registerLinkText}>{t('auth.registerNow')}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPaddingH,
    justifyContent: 'center',
    paddingTop: spacing.md,
    paddingBottom: layout.screenPaddingBottom,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent + '26',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...textStyles.pageTitle,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  input: {
    marginBottom: spacing.md,
  },
  errorText: {
    ...textStyles.bodySmall,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  primaryButton: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  registerLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerText: {
    ...textStyles.bodySmall,
    textAlign: 'center',
  },
  registerLinkText: {
    color: colors.accent,
    fontWeight: '700',
  },
});
