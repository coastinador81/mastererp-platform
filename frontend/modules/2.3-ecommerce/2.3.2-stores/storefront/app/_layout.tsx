import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider } from '@/store/StoreProvider';
import { colors, contentWidth } from '@/theme';
import '../src/storefront-theme.css';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <View style={styles.viewport}>
          <View style={styles.appShell}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
          </View>
        </View>
      </StoreProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    backgroundColor: Platform.OS === 'web' ? colors.canvas : colors.surface,
  },
  appShell: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.surface,
    ...Platform.select({
      web: {
        maxWidth: contentWidth,
        shadowColor: '#111827',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 0 },
      },
      default: {},
    }),
  },
});
