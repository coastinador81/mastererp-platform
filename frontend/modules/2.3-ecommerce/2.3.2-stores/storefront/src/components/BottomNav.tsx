import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, contentWidth, spacing } from '../theme';
import { useStore } from '../store/StoreProvider';

const items = [
  { label: 'Inicio', icon: 'home-outline', activeIcon: 'home', path: '/' },
  { label: 'Categorías', icon: 'grid-outline', activeIcon: 'grid', path: '/catalog' },
  { label: 'Ofertas', icon: 'pricetag-outline', activeIcon: 'pricetag', path: '/offers' },
  { label: 'Compras', icon: 'bag-handle-outline', activeIcon: 'bag-handle', path: '/orders' },
  { label: 'Mi cuenta', icon: 'person-outline', activeIcon: 'person', path: '/account' },
] as const;

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { cart } = useStore();
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  return <View style={styles.shell}><View style={styles.nav}>{items.map(item => {
    const target = item.path.split('?')[0];
    const active = target === '/' ? pathname === '/' : pathname.startsWith(target);
    return <Pressable key={item.label} style={styles.item} onPress={() => router.push(item.path)} accessibilityLabel={item.label}>
      <View><Ionicons name={active ? item.activeIcon : item.icon} size={22} color={active ? colors.primary : colors.muted} />
        {item.label === 'Compras' && count ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
      </View><Text style={[styles.label, active && styles.active]}>{item.label}</Text>
    </Pressable>;
  })}</View></View>;
}

const styles = StyleSheet.create({
  shell: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  nav: { width: '100%', maxWidth: contentWidth, minHeight: 64, alignSelf: 'center', flexDirection: 'row', paddingHorizontal: spacing.sm },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { color: colors.muted, fontSize: 9, fontWeight: '700' }, active: { color: colors.primaryDark },
  badge: { position: 'absolute', top: -7, right: -10, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.offer, borderWidth: 2, borderColor: colors.surface },
  badgeText: { color: colors.surface, fontSize: 9, fontWeight: '900' },
});
