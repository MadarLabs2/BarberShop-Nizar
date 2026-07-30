import { View, StyleSheet, ViewStyle } from 'react-native';
import { ReactNode } from 'react';
import { colors, layout } from '../../theme';

interface ScreenProps {
  children?: ReactNode;
  style?: ViewStyle;
  /** When true, no horizontal padding (e.g. for full-width headers) */
  noPadding?: boolean;
}

export function Screen({ children, style, noPadding }: ScreenProps) {
  return (
    <View style={[styles.container, noPadding && styles.noPadding, style]}>
      {children ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPaddingH,
  },
  noPadding: {
    paddingHorizontal: 0,
  },
});
