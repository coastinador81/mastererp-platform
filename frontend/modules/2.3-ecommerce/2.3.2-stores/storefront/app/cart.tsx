import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);

export default function CartPage() {
  const router = useRouter();
  const { cart, setQuantity } = useStore();
  const priceOf = (line: (typeof cart)[number]) => line.product.offer_price != null && line.product.offer_price < line.product.price ? line.product.offer_price : line.product.price;
  const subtotal = cart.reduce((total, line) => total + priceOf(line) * line.quantity, 0);
  return (
    <Screen>
      <View style={styles.heading}><Text style={styles.eyebrow}>TU SELECCIÓN</Text><Text style={styles.title}>Mi carrito</Text><Text style={styles.subtitle}>{cart.length ? 'Revisa las cantidades antes de continuar.' : 'Aún no agregaste productos.'}</Text></View>
      {!cart.length ? <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name="bag-handle-outline" size={42} color={colors.primary} /></View><Text style={styles.emptyTitle}>Tu carrito está esperando</Text><Text style={styles.emptyText}>Explora el catálogo y agrega todo lo que necesites.</Text><Pressable style={styles.primary} onPress={() => router.replace('/catalog')}><Text style={styles.primaryText}>Ver productos</Text></Pressable></View> :
      <View style={styles.layout}>
        <View style={styles.lines}>{cart.map(line => { const { product, quantity } = line; const unitPrice = priceOf(line); return <View key={product.id} style={styles.line}>
          <View style={styles.thumb}>{product.image_url ? <Image source={{ uri: product.image_url }} style={styles.image} /> : <Ionicons name="basket-outline" size={30} color={colors.primary} />}</View>
          <View style={styles.lineCopy}><Text style={styles.lineName}>{product.name}</Text><Text style={styles.unitPrice}>{money(unitPrice)} c/u</Text><Pressable style={styles.removeButton} onPress={() => setQuantity(product.id, 0)}><Ionicons name="trash-outline" size={17} color={colors.ink} /><Text style={styles.remove}>Eliminar</Text></Pressable></View>
          <View style={styles.quantity}><Pressable style={styles.quantityButton} onPress={() => setQuantity(product.id, quantity - 1)}><Ionicons name="remove" size={17} color={colors.primaryDark} /></Pressable><Text style={styles.quantityText}>{quantity}</Text><Pressable style={styles.quantityButton} onPress={() => setQuantity(product.id, quantity + 1)}><Ionicons name="add" size={17} color={colors.primaryDark} /></Pressable></View>
          <Text style={styles.lineTotal}>{money(unitPrice * quantity)}</Text>
        </View>;})}</View>
        <View style={styles.summary}><Text style={styles.summaryTitle}>Resumen</Text><View style={styles.row}><Text style={styles.label}>Productos</Text><Text style={styles.value}>{money(subtotal)}</Text></View><View style={styles.row}><Text style={styles.label}>Entrega</Text><Text style={styles.pending}>Se calcula al confirmar</Text></View><View style={styles.divider} /><View style={styles.row}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.total}>{money(subtotal)}</Text></View><Pressable style={styles.primary} onPress={() => router.push('/checkout')}><Text style={styles.primaryText}>Continuar al checkout</Text><Ionicons name="arrow-forward" size={19} color={colors.surface} /></Pressable><Text style={styles.secure}>Precios e inventario se validarán al confirmar.</Text></View>
      </View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: 42, paddingBottom: spacing.lg }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, title: { marginTop: 5, color: colors.ink, fontSize: 34, fontWeight: '900' }, subtitle: { marginTop: 6, color: colors.muted },
  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-start' }, lines: { flex: 2, minWidth: 300, gap: spacing.sm }, line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface }, thumb: { width: 82, height: 82, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primarySoft }, image: { width: '100%', height: '100%', resizeMode: 'cover' }, lineCopy: { flex: 1, minWidth: 130 }, lineName: { color: colors.ink, fontSize: 15, fontWeight: '900' }, unitPrice: { marginTop: 4, color: colors.muted, fontSize: 12 }, removeButton: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }, remove: { color: colors.text, fontSize: 11, fontWeight: '700' }, quantity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.canvas }, quantityButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }, quantityText: { minWidth: 22, color: colors.ink, textAlign: 'center', fontWeight: '900' }, lineTotal: { minWidth: 80, color: colors.ink, fontSize: 15, fontWeight: '900', textAlign: 'right' },
  summary: { flex: 1, minWidth: 280, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, summaryTitle: { marginBottom: spacing.lg, color: colors.ink, fontSize: 20, fontWeight: '900' }, row: { marginBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, label: { color: colors.muted }, value: { color: colors.ink, fontWeight: '800' }, pending: { color: colors.primary, fontSize: 12, fontWeight: '800' }, divider: { height: 1, marginBottom: spacing.md, backgroundColor: colors.line }, totalLabel: { color: colors.ink, fontSize: 17, fontWeight: '900' }, total: { color: colors.ink, fontSize: 19, fontWeight: '900' }, primary: { minHeight: 54, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.md, backgroundColor: colors.primary }, primaryText: { color: colors.surface, fontWeight: '900' }, secure: { marginTop: spacing.md, color: colors.muted, fontSize: 10, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface }, emptyIcon: { width: 86, height: 86, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: colors.primarySoft }, emptyTitle: { marginTop: spacing.lg, color: colors.ink, fontSize: 24, fontWeight: '900' }, emptyText: { marginTop: spacing.sm, color: colors.muted },
});
