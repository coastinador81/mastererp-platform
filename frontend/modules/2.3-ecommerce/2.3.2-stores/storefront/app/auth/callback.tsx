import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppLoading } from '@/components/AppLoading';
import { Screen } from '@/components/Screen';
import { startLogin } from '@/auth';
import { useStore } from '@/store/StoreProvider';
import { colors } from '@/theme';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { authenticated, loading, error } = useStore();
  useEffect(() => { if (!loading && authenticated) router.replace('/'); }, [authenticated, loading, router]);
  if (loading || authenticated) return <Screen><AppLoading title="Iniciando sesión…" detail="Estamos preparando tu cuenta y tu tienda." /></Screen>;
  return <Screen><View style={styles.wrap}><Text style={styles.title}>No pudimos iniciar sesión</Text><Text style={styles.text}>{error || 'Intenta nuevamente para continuar.'}</Text><Pressable style={styles.button} onPress={() => void startLogin()}><Text style={styles.buttonText}>Intentar de nuevo</Text></Pressable></View></Screen>;
}

const styles = StyleSheet.create({
  wrap: { minHeight: 320, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  text: { maxWidth: 300, marginTop: 8, color: colors.muted, lineHeight: 20, textAlign: 'center' },
  button: { minHeight: 50, marginTop: 22, justifyContent: 'center', paddingHorizontal: 24, borderRadius: 999, backgroundColor: colors.primary },
  buttonText: { color: colors.surface, fontWeight: '900' },
});
