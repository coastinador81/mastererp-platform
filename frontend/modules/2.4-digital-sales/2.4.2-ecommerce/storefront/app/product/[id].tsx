import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);

export default function ProductPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { catalog, add } = useStore();
  const product = catalog?.products.find(item => item.id === id);
  if (!product) return <Screen><View style={styles.empty}><Text style={styles.title}>Producto no disponible</Text><Pressable onPress={() => router.replace('/catalog')}><Text style={styles.backLink}>Volver al catálogo</Text></Pressable></View></Screen>;
  const available = product.available > 0;
  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={19} color={colors.primaryDark} /><Text style={styles.backText}>Volver</Text></Pressable>
      <View style={styles.layout}>
        <View style={styles.imageWrap}>{product.image_url ? <Image source={{ uri: product.image_url }} style={styles.image} /> : <Ionicons name="basket-outline" size={82} color={colors.primary} />}</View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{product.brand_ref || 'PRODUCTO DE LA TIENDA'}</Text>
          <Text style={styles.title}>{product.name}</Text>
          <Text style={styles.description}>{product.description || 'Producto seleccionado y disponible para tu compra.'}</Text>
          <View style={styles.availability}><Ionicons name={available ? 'checkmark-circle' : 'close-circle'} size={19} color={available ? colors.success : colors.danger} /><Text style={[styles.availabilityText, !available && styles.unavailable]}>{available ? 'Disponible para agregar' : 'No disponible por ahora'}</Text></View>
          <Text style={styles.price}>{money(product.price)}</Text>
          <Pressable style={[styles.add, !available && styles.disabled]} disabled={!available} onPress={() => { add(product); router.push('/cart'); }}><Ionicons name="bag-add-outline" size={22} color={colors.surface} /><Text style={styles.addText}>Agregar al carrito</Text></Pressable>
          <View style={styles.trust}><Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} /><View><Text style={styles.trustTitle}>Compra protegida por MasterERP</Text><Text style={styles.trustText}>El precio y el inventario se validan nuevamente al crear tu pedido.</Text></View></View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm }, backText: { color: colors.primaryDark, fontWeight: '800' }, backLink: { marginTop: spacing.md, color: colors.primary, fontWeight: '800' },
  layout: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface }, imageWrap: { flex: 1, minWidth: 280, minHeight: 420, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.primarySoft }, image: { width: '100%', height: '100%', resizeMode: 'cover' }, copy: { flex: 1, minWidth: 280, justifyContent: 'center', padding: spacing.md }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, title: { marginTop: spacing.sm, color: colors.ink, fontSize: 38, lineHeight: 44, fontWeight: '900', letterSpacing: -1.2 }, description: { marginTop: spacing.md, color: colors.muted, fontSize: 16, lineHeight: 26 }, availability: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, availabilityText: { color: colors.success, fontWeight: '800' }, unavailable: { color: colors.danger }, price: { marginTop: spacing.lg, color: colors.ink, fontSize: 29, fontWeight: '900' }, add: { marginTop: spacing.lg, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.primary }, addText: { color: colors.surface, fontSize: 16, fontWeight: '900' }, disabled: { opacity: 0.45 }, trust: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft }, trustTitle: { color: colors.primaryDark, fontSize: 12, fontWeight: '900' }, trustText: { maxWidth: 380, marginTop: 3, color: colors.muted, fontSize: 11 }, empty: { marginTop: 80, alignItems: 'center' },
});
