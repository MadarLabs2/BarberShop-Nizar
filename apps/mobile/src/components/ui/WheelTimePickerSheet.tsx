import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatTimeHHMM, timeHHMMToReferenceDate } from '../../utils/dates';
import { useAppLocale } from '../../contexts/LocaleContext';
import { colors, spacing, radius, textStyles } from '../../theme';

const IOS_TEXT = colors.text;

export type WheelTimePickerSheetProps = {
  visible: boolean;
  title: string;
  /** Current value as HH:MM (e.g. 09:00). */
  valueHHMM: string;
  onRequestClose: () => void;
  /** Called when the user confirms (iOS: common.done; Android: after system dialog selection). */
  onConfirm: (timeHHMM: string) => void;
  /**
   * Use when this picker is already inside another `Modal` (e.g. admin block dialog).
   * Nested Modals on iOS often show nothing — render as an absolute overlay instead.
   */
  presentation?: 'modal' | 'inline';
};

/**
 * Bottom-sheet style wheel time picker (24h), matching blocked-times / iOS spinner UX.
 * Renders outside ScrollView parents; safe for RTL apps.
 */
export function WheelTimePickerSheet({
  visible,
  title,
  valueHHMM,
  onRequestClose,
  onConfirm,
  presentation = 'modal',
}: WheelTimePickerSheetProps) {
  const { t } = useTranslation();
  const { pickerLocale } = useAppLocale();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => timeHHMMToReferenceDate(valueHHMM));

  useEffect(() => {
    if (visible) setDraft(timeHHMMToReferenceDate(valueHHMM));
  }, [visible, valueHHMM]);

  const commit = (d: Date) => {
    onConfirm(formatTimeHHMM(d));
    onRequestClose();
  };

  const onAndroidChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed') {
      onRequestClose();
      return;
    }
    if (selected) commit(selected);
  };

  const iosSheet = (
    <Pressable style={styles.backdrop} onPress={onRequestClose}>
      <Pressable
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        onPress={(e) => e.stopPropagation()}
      >
        <Text style={styles.sheetTitle}>{title}</Text>
        <View style={styles.spinnerWrap}>
          <DateTimePicker
            value={draft}
            mode="time"
            display="spinner"
            is24Hour
            locale={pickerLocale}
            themeVariant="light"
            textColor={IOS_TEXT}
            onChange={(_, d) => d && setDraft(d)}
          />
        </View>
        <TouchableOpacity style={styles.doneBtn} onPress={() => commit(draft)} activeOpacity={0.88}>
          <Text style={styles.doneBtnText}>{t('common.done')}</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
  );

  if (presentation === 'inline') {
    return (
      <>
        {visible && Platform.OS === 'android' ? (
          <DateTimePicker
            value={draft}
            mode="time"
            display="default"
            is24Hour
            onChange={onAndroidChange}
          />
        ) : null}
        {visible && Platform.OS === 'ios' ? (
          <View style={styles.inlineLayer} pointerEvents="box-none">
            {iosSheet}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <>
      {visible && Platform.OS === 'android' ? (
        <DateTimePicker
          value={draft}
          mode="time"
          display="default"
          is24Hour
          onChange={onAndroidChange}
        />
      ) : null}

      {visible && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={onRequestClose}>
          {iosSheet}
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  inlineLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 28,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  sheet: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    maxHeight: '88%',
  },
  sheetTitle: {
    ...textStyles.sectionTitle,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    color: colors.text,
  },
  spinnerWrap: {
    width: '100%',
    minHeight: 216,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneBtn: {
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onPrimary,
  },
});
