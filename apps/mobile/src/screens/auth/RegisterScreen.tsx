import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Linking,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { AppInput } from '../../components/ui/AppInput';
import { AppButton } from '../../components/ui/AppButton';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { useAuth } from '../../hooks/useAuth';
import { isValidPhone, validateBirthDate } from '../../utils/validators';
import { openDrawer } from '../../utils/nav';
import { TERMS_URL, BARBERSHOP_PHONE_INTL } from '../../lib/config';
import { colors, shadows, radius, spacing, layout, textStyles, iconSize } from '../../theme';

export function RegisterScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { register: doRegister, requestOtp, isLoading } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');

  const birthResult = validateBirthDate(day, month, year);
  const isValid =
    firstName.trim() &&
    lastName.trim() &&
    isValidPhone(phone) &&
    birthResult.valid &&
    terms;

  const birthDateStr =
    year && month && day
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : undefined;

  const handleContinue = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError(t('register.namesRequired'));
      return;
    }
    if (!isValidPhone(phone)) {
      setError(t('register.invalidPhone'));
      return;
    }
    if (!birthResult.valid) {
      setError(birthResult.error ?? t('register.birthInvalidFallback'));
      return;
    }
    if (!terms) {
      setError(t('register.termsRequired'));
      return;
    }
    setError('');
    try {
      const { phone: normalizedPhone } = await doRegister({
        phone,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        birthDate: birthDateStr,
      });
      const otpRes = await requestOtp(normalizedPhone);
      if (otpRes.devCode) {
        Alert.alert(t('verifyOtp.devCodeTitle'), otpRes.devCode);
      }
      (navigation.navigate as (s: string, p?: object) => void)('VerifyOtp', {
        phoneNumber: normalizedPhone,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        birthDate: birthDateStr,
        otpCodeLength: otpRes.otpCodeLength,
        resendAvailableAt: otpRes.resendAvailableAt,
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : t('register.registerError');
      let friendly = raw;
      if (raw === 'PHONE_ALREADY_REGISTERED') {
        friendly = t('register.phoneRegistered');
      } else if (raw === 'PHONE_BELONGS_TO_STAFF') {
        friendly = t('register.phoneStaff');
      } else if (raw.includes('SMS_SEND_FAILED')) {
        friendly = t('verifyOtp.otpSendFailed');
      } else if (raw.includes('OTP_DB_INSERT_FAILED')) {
        friendly = `${raw}\n${t('verifyOtp.otpDbInsertFailedHint')}`;
      } else if (/network|request failed|fetch|failed to fetch/i.test(raw)) {
        friendly = t('common.networkError');
      }
      setError(friendly);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <BlackHeader
        title={t('screenTitles.Register')}
        onBackPress={() => navigation.goBack()}
        onMenuPress={() => openDrawer(navigation as unknown as Record<string, unknown>)}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={iconSize.xl + 14} color={colors.accent} />
            <View style={styles.avatarBadge}>
              <Ionicons name="add" size={16} color={colors.onPrimary} />
            </View>
          </View>
          <Text style={styles.cardTitle}>{t('register.cardTitle')}</Text>
          <Text style={styles.cardSubtitle}>{t('register.cardSubtitle')}</Text>

          <AppInput
            placeholder={t('register.firstName')}
            required
            value={firstName}
            onChangeText={(v) => {
              setFirstName(v);
              setError('');
            }}
            textAlign="right"
            style={styles.fieldGap}
          />
          <AppInput
            placeholder={t('register.lastName')}
            required
            value={lastName}
            onChangeText={(v) => {
              setLastName(v);
              setError('');
            }}
            textAlign="right"
            style={styles.fieldGap}
          />
          <AppInput
            placeholder={t('register.phone')}
            accessibilityLabel={t('auth.phoneLabelA11y')}
            required
            value={phone}
            onChangeText={(v) => {
              setPhone(v);
              setError('');
            }}
            keyboardType="phone-pad"
            maxLength={10}
            textAlign="right"
            style={styles.fieldGap}
          />

          <Text style={styles.label}>{t('register.birthDate')}</Text>
          {birthResult.valid === false && day && month && year ? (
            <Text style={styles.dateError}>{birthResult.error}</Text>
          ) : null}
          <View style={styles.dateRow}>
            <TextInput
              style={[styles.dateInput, styles.dateInputYear]}
              placeholder={t('register.year')}
              placeholderTextColor={colors.textTertiary}
              value={year}
              onChangeText={setYear}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel={`${t('register.birthDate')}, ${t('register.year')}, ${t('common.requiredFieldA11y')}`}
            />
            <TextInput
              style={[styles.dateInput, styles.dateInputMd]}
              placeholder={t('register.month')}
              placeholderTextColor={colors.textTertiary}
              value={month}
              onChangeText={setMonth}
              keyboardType="number-pad"
              maxLength={2}
              accessibilityLabel={`${t('register.birthDate')}, ${t('register.month')}, ${t('common.requiredFieldA11y')}`}
            />
            <TextInput
              style={[styles.dateInput, styles.dateInputMd]}
              placeholder={t('register.day')}
              placeholderTextColor={colors.textTertiary}
              value={day}
              onChangeText={setDay}
              keyboardType="number-pad"
              maxLength={2}
              accessibilityLabel={`${t('register.birthDate')}, ${t('register.day')}, ${t('common.requiredFieldA11y')}`}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.termsRow}>
            <TouchableOpacity
              style={styles.termsCheckWrap}
              onPress={() => setTerms(!terms)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: terms }}
              accessibilityLabel={t('register.termsPrefix')}
            >
              <View style={[styles.checkbox, terms && styles.checkboxChecked]}>
                {terms && <Ionicons name="checkmark" size={14} color={colors.onPrimary} />}
              </View>
              <Text style={styles.termsText}>{t('register.termsPrefix')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (TERMS_URL) {
                  Linking.openURL(TERMS_URL);
                } else {
                  Alert.alert(
                    t('register.termsAlertTitle'),
                    t('register.termsAlertMsg'),
                    [
                      { text: t('common.ok'), style: 'cancel' },
                      { text: t('settings.openWhatsApp'), onPress: () => Linking.openURL(`https://wa.me/${BARBERSHOP_PHONE_INTL.replace('+', '')}`) },
                    ]
                  );
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.termsLink}>{t('register.termsLink')}</Text>
            </TouchableOpacity>
          </View>

          <AppButton
            title={t('auth.continue')}
            onPress={handleContinue}
            disabled={!isValid}
            loading={isLoading}
            style={styles.primaryButton}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: layout.screenPaddingBottom,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accent + '26',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
    position: 'relative',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    ...textStyles.pageTitle,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    ...textStyles.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  fieldGap: {
    marginBottom: spacing.md,
  },
  label: {
    ...textStyles.label,
    marginBottom: spacing.sm,
  },
  dateError: {
    ...textStyles.caption,
    color: colors.danger,
    marginBottom: spacing.xs,
  },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.sm,
    fontSize: 16,
    minHeight: layout.hitMin,
    backgroundColor: colors.surface,
    color: colors.text,
    textAlign: 'center',
  },
  dateInputYear: { flex: 1.2 },
  dateInputMd: { flex: 1 },
  errorText: {
    ...textStyles.bodySmall,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  termsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  termsCheckWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  termsText: {
    ...textStyles.bodySmall,
  },
  termsLink: {
    color: colors.accent,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: spacing.xs,
  },
});
