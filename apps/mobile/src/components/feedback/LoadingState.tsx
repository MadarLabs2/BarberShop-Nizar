import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';

export function LoadingState() {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
});
