import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

export function AppLoading({ title = 'Cargando…', detail }: { title?: string; detail?: string }) {
  return <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
    <View style={styles.spinner}><ActivityIndicator size="large" color={colors.primary} /></View>
    <Text style={styles.title}>{title}</Text>
    {detail ? <Text style={styles.detail}>{detail}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  spinner: { width: 78, height: 78, alignItems: 'center', justifyContent: 'center', borderRadius: radii.lg, backgroundColor: colors.primarySoft },
  title: { marginTop: spacing.lg, color: colors.ink, fontSize: 20, fontWeight: '900' },
  detail: { maxWidth: 280, marginTop: spacing.xs, color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
