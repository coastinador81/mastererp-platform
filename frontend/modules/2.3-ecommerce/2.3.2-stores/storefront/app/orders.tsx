import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { loadOrders } from '@/api';
import { startLogin } from '@/auth';
import { AppLoading } from '@/components/AppLoading';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';
import type { CustomerOrder } from '@/types';

export default function OrdersPage() {
  const router = useRouter();
  const { authenticated, sessionLoading } = useStore();
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionLoading || !authenticated) return;
    let active = true;
    loadOrders()
      .then(items => { if (active) setOrders(items); })
      .catch(() => { if (active) setError('No pudimos cargar tus pedidos.'); });
    return () => { active = false; };
  }, [authenticated, sessionLoading]);

  if (sessionLoading) return <Screen><AppLoading title="Recuperando tu sesión…" detail="Estamos preparando tus compras." /></Screen>;
  return <Screen><View style={styles.wrap}>
    <Text style={styles.title}>Mis pedidos</Text>
    {!authenticated ? <><Text style={styles.empty}>Inicia sesión para consultar tus compras.</Text><Pressable style={styles.login} onPress={() => void startLogin()}><Text style={styles.loginText}>Iniciar sesión</Text></Pressable></> : null}
    {authenticated && orders === null && !error ? <AppLoading title="Cargando tus pedidos…" detail="Esto puede tomar unos segundos." /> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {orders?.map(order => <Pressable key={order.id} style={styles.card} onPress={() => router.push(`/order/${order.id}`)}>
      <View><Text style={styles.number}>{order.number}</Text><Text style={styles.date}>{new Date(order.created_at).toLocaleDateString('es-VE')}</Text></View>
      <View><Text style={styles.status}>{order.status}</Text><Text style={styles.total}>{order.currency} {Number(order.total).toFixed(2)}</Text></View>
    </Pressable>)}
    {!error && orders?.length === 0 ? <Text style={styles.empty}>Todavía no tienes pedidos en esta tienda.</Text> : null}
  </View></Screen>;
}

const styles = StyleSheet.create({
  wrap: { maxWidth: 760, width: '100%', alignSelf: 'center', paddingVertical: 40 },
  title: { fontSize: 30, fontWeight: '900', color: colors.ink },
  card: { marginTop: spacing.md, padding: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', borderRadius: radii.md, backgroundColor: colors.surface },
  number: { fontWeight: '900', color: colors.ink }, date: { marginTop: 5, color: colors.muted },
  status: { color: colors.primaryDark, fontWeight: '900', textAlign: 'right' }, total: { marginTop: 5, color: colors.ink, fontWeight: '800' },
  empty: { marginTop: spacing.xl, color: colors.muted }, error: { marginTop: spacing.lg, color: colors.danger },
  login: { alignSelf: 'flex-start', marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.primary },
  loginText: { color: colors.surface, fontWeight: '900' },
});
