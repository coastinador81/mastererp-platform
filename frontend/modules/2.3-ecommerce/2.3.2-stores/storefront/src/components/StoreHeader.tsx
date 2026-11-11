import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, usePathname, useRouter } from 'expo-router';
import { Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, contentWidth, spacing } from '../theme';
import { useStore } from '../store/StoreProvider';
import { HeaderMenu } from './HeaderMenu';

export function StoreHeader() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = Platform.OS === 'web' || width < 700;
  const pathname = usePathname();
  const { catalog, cart, driverAccess } = useStore();
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const storeName = catalog?.store.name || '';
  const configuredLogoUrl = catalog?.store.branding?.logoUrl;
  const logoUrl = configuredLogoUrl?.startsWith('https://') ? configuredLogoUrl : '';
  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        {compact ? <HeaderMenu /> : null}
        <Pressable style={styles.brand} onPress={() => router.push('/')} accessibilityLabel="Ir al inicio">
          <View style={[styles.mark, storeName && {backgroundColor:catalog?.store.branding?.primaryColor||colors.primary}, logoUrl && styles.logoMark, !storeName && styles.markLoading]}>{logoUrl ? <Image source={{uri:logoUrl}} style={styles.logo} resizeMode="contain" /> : storeName ? <Text style={styles.markText}>{storeName.slice(0,1).toUpperCase()}</Text> : null}</View>
          <View style={styles.brandCopy}>{storeName ? <Text style={styles.name} numberOfLines={1}>{storeName}</Text> : <View style={styles.nameLoading} />}{compact || !storeName ? null : <Text style={styles.tag}>Tu tienda, a tu manera</Text>}</View>
        </Pressable>
        {compact ? null : <View style={styles.nav}>
          <Link href="/" asChild><Pressable><Text style={[styles.link, pathname === '/' && styles.active]}>Inicio</Text></Pressable></Link>
          <Link href="/catalog" asChild><Pressable><Text style={[styles.link, pathname === '/catalog' && styles.active]}>Catálogo</Text></Pressable></Link>
        </View>}
        <View style={[styles.actions, compact && styles.actionsCompact]}>
          {driverAccess?<Pressable style={styles.routes} onPress={()=>router.push('/driver-routes')} accessibilityLabel="Mis rutas"><Ionicons name="bicycle-outline" size={22} color={colors.primary}/><Text style={styles.routesText}>Mis rutas</Text></Pressable>:null}
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
  markLoading: { backgroundColor: colors.line },
  logoMark: { backgroundColor: colors.surface },
  logo: { width: 31, height: 31, borderRadius: 9 },
  markText: { color: colors.surface, fontSize: 21, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  nameLoading: { width: 145, height: 16, borderRadius: 8, backgroundColor: colors.line },
  tag: { color: colors.muted, fontSize: 10 },
  nav: { flexDirection: 'row', gap: spacing.lg },
  link: { color: colors.muted, fontSize: 14, fontWeight: '700', paddingVertical: 10 },
  active: { color: colors.primary },
  actions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  actionsCompact: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  routes:{height:43,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:6,borderRadius:14,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  routesText:{color:colors.primary,fontSize:13,fontWeight:'800'},
  cart: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  badgeText: { color: colors.ink, fontSize: 10, fontWeight: '900' },
});
