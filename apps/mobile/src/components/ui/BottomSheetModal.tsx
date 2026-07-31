import React, { useState, useEffect } from 'react';
import {
  Modal,
  TouchableOpacity,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, textStyles, shadows, iconSize, layout } from '../../theme';

interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children?: React.ReactNode;
}

const OPEN_MS = 380;
const CLOSE_MS = 300;

export function BottomSheetModal({ visible, onClose, title, children }: BottomSheetModalProps) {
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();
  const scrollMaxHeight = Math.round(windowHeight * 0.62);

  const [modalVisible, setModalVisible] = useState(false);
  const translateY = useSharedValue(windowHeight);
  const backdropOpacity = useSharedValue(0);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      translateY.value = windowHeight;
      translateY.value = withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
      backdropOpacity.value = withTiming(1, { duration: OPEN_MS - 80 });
    } else {
      backdropOpacity.value = withTiming(0, { duration: CLOSE_MS });
      translateY.value = withTiming(
        windowHeight,
        { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setModalVisible)(false);
        },
      );
    }
  }, [visible, windowHeight, translateY, backdropOpacity]);

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay} accessibilityViewIsModal>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.closeA11y')}
          />
        </Animated.View>
        <Animated.View style={[styles.bottomSheet, sheetStyle]}>
          <View style={styles.sheetHandle} />
          <TouchableOpacity
            style={styles.modalClose}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.closeA11y')}
          >
            <Ionicons name="close" size={iconSize.lg + 2} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle} accessibilityRole="header">{title}</Text>
          <ScrollView
            style={[styles.sheetScroll, { maxHeight: scrollMaxHeight }]}
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            bounces
          >
            {children ?? null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: colors.overlay,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 40 : spacing.lg,
    maxHeight: '88%',
    width: '100%',
    zIndex: 2,
    ...Platform.select({
      ios: shadows.sheet,
      android: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 24 },
    }),
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.borderSubtle,
    borderRadius: radius.sm,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalClose: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.sm,
    zIndex: 10,
    padding: spacing.sm,
    minWidth: layout.hitMin,
    minHeight: layout.hitMin,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    ...textStyles.sectionTitle,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  sheetScroll: {
    flexGrow: 0,
    width: '100%',
  },
  sheetScrollContent: {
    paddingBottom: spacing.xl,
    alignItems: 'center',
    width: '100%',
  },
});
