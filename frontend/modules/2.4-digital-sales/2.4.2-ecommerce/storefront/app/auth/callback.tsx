import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors } from '@/theme';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { authenticated, loading } = useStore();
  useEffect(() => { if (!loading && authenticated) router.replace('/'); }, [authenticated, loading, router]);
  return <Screen><View style={styles.wrap}><Text style={styles.text}>Validando tu acceso…</Text></View></Screen>;
}

const styles = StyleSheet.create({ wrap: { marginTop: 80, alignItems: 'center' }, text: { color: colors.muted } });
