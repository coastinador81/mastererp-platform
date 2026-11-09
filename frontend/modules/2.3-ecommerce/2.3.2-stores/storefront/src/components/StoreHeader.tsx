import { Ionicons } from '@expo/vector-icons';
import { Link, usePathname, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { isAuthenticated, signOut, startLogin } from '../auth';
import { colors, contentWidth, radii, spacing } from '../theme';
import { useStore } from '../store/StoreProvider';
import { HeaderMenu } from './HeaderMenu';

export function StoreHeader() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = Platform.OS === 'web' || width < 700;
  const pathname = usePathname();
  const { catalog, cart, authenticated } = useStore();
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const onSession = async () => {
    if (isAuthenticated()) signOut();
    else await startLogin();
  };
  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        {compact ? <HeaderMenu /> : null}
        <Pressable style={styles.brand} onPress={() => router.push('/')} accessibilityLabel="Ir al inicio">
          <View style={styles.mark}><Text style={styles.markText}>M</Text></View>
          <View style={styles.brandCopy}><Text style={styles.name} numberOfLines={1}>{catalog?.store.name || 'MasterERP'}</Text>{compact ? null : <Text style={styles.tag}>Tu tienda, a tu manera</Text>}</View>
        </Pressable>
        {compact ? null : <View style={styles.nav}>
          <Link href="/" asChild><Pressable><Text style={[styles.link, pathname === '/' && styles.active]}>Inicio</Text></Pressable></Link>
          <Link href="/catalog" asChild><Pressable><Text style={[styles.link, pathname === '/catalog' && styles.active]}>Catálogo</Text></Pressable></Link>
        </View>}
        <View style={[styles.actions, compact && styles.actionsCompact]}>
          <Pressable style={styles.session} onPress={() => void onSession()} accessibilityLabel={authenticated ? 'Cerrar sesión' : 'Acceder'}>
            <Ionicons name={authenticated ? 'person-circle' : 'person-outline'} size={21} color={colors.primaryDark} />
            {compact ? null : <Text style={styles.sessionText}>{authenticated ? 'Mi cuenta' : 'Acceder'}</Text>}
          </Pressable>
          <Pressable style={styles.cart} onPress={() => router.push('/cart')} accessibilityLabel={`Carrito con ${count} productos`}>
            <Ionicons name="bag-handle-outline" size={22} color={colors.surface} />
            {count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  header: { width: '100%', maxWidth: contentWidth, minHeight: 76, alignSelf: 'center', paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minWidth: 0 },
  brandCopy: { flexShrink: 1, minWidth: 0 },
  mark: { width: 39, height: 39, flexShrink: 0, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  markText: { color: colors.surface, fontSize: 21, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  tag: { color: colors.muted, fontSize: 10 },
  nav: { flexDirection: 'row', gap: spacing.lg },
  link: { color: colors.muted, fontSize: 14, fontWeight: '700', paddingVertical: 10 },
  active: { color: colors.primary },
  actions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  actionsCompact: { flex: 0 },
  session: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.primarySoft },
  sessionText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  cart: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  badgeText: { color: colors.ink, fontSize: 10, fontWeight: '900' },
});
