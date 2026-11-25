import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';
import { cartLineKey, cartLinePrice, variantImageUrl } from '@/types';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);

export default function CartPage() {
  const router = useRouter();
  const { cart, catalog, setQuantity } = useStore();
  const priceOf = cartLinePrice;
  const subtotal = cart.reduce((total, line) => total + priceOf(line) * line.quantity, 0);
  const configuredDeliveryFee = Number(catalog?.store.configuration?.deliveryFee || 0);
  const deliveryFee = Number.isFinite(configuredDeliveryFee) ? configuredDeliveryFee : 0;
  const total = subtotal + deliveryFee;
  return (
    <Screen>
      <View style={styles.heading}><Text style={styles.eyebrow}>TU SELECCIÓN</Text><Text style={styles.title}>Mi carrito</Text><Text style={styles.subtitle}>{cart.length ? 'Revisa las cantidades antes de continuar.' : 'Aún no agregaste productos.'}</Text></View>
      {!cart.length ? <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name="bag-handle-outline" size={42} color={colors.primary} /></View><Text style={styles.emptyTitle}>Tu carrito está esperando</Text><Text style={styles.emptyText}>Explora el catálogo y agrega todo lo que necesites.</Text><Pressable style={styles.primary} onPress={() => router.replace('/catalog')}><Text style={styles.primaryText}>Ver productos</Text></Pressable></View> :
      <View style={styles.layout}>
        <View style={styles.lines}>{cart.map(line => { const { product, quantity, variant } = line; const unitPrice = priceOf(line), lineKey = cartLineKey(line); const imageUrl = variantImageUrl(line); return <View key={lineKey} style={styles.line}>
          <View style={styles.lineTop}><View style={styles.thumb}>{imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} /> : <Ionicons name="basket-outline" size={30} color={colors.primary} />}</View>
          <View style={styles.lineCopy}><Text style={styles.lineName}>{product.name}</Text>{variant?<Text style={styles.variant}>{variant.label || Object.values(variant.values||{}).join(' / ')}</Text>:null}<Text style={styles.unitPrice}>{money(unitPrice)} c/u</Text></View><Pressable style={styles.removeButton} onPress={() => setQuantity(lineKey, 0)} accessibilityLabel={`Eliminar ${product.name}`}><Ionicons name="trash-outline" size={18} color={colors.muted} /></Pressable></View>
          <View style={styles.lineBottom}><View style={styles.quantity}><Pressable style={styles.quantityButton} onPress={() => setQuantity(lineKey, quantity - 1)}><Ionicons name="remove" size={17} color={colors.primaryDark} /></Pressable><Text style={styles.quantityText}>{quantity}</Text><Pressable style={styles.quantityButton} onPress={() => setQuantity(lineKey, quantity + 1)}><Ionicons name="add" size={17} color={colors.primaryDark} /></Pressable></View><Text style={styles.lineTotal}>{money(unitPrice * quantity)}</Text></View>
        </View>;})}</View>
        <View style={styles.summary}><Text style={styles.summaryTitle}>Resumen</Text><View style={styles.row}><Text style={styles.label}>Productos</Text><Text style={styles.value}>{money(subtotal)}</Text></View><View style={styles.row}><Text style={styles.label}>Entrega</Text><Text style={styles.value}>{money(deliveryFee)}</Text></View><View style={styles.divider} /><View style={styles.row}><Text style={styles.totalLabel}>Total</Text><Text style={styles.total}>{money(total)}</Text></View><Pressable style={styles.primary} onPress={() => router.push('/checkout')}><Text style={styles.primaryText}>Continuar al checkout</Text><Ionicons name="arrow-forward" size={19} color={colors.surface} /></Pressable><Text style={styles.secure}>Tarifa correspondiente al nodo seleccionado. Precios e inventario se validarán al confirmar.</Text></View>
      </View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: 30, paddingBottom: 22 }, eyebrow: { color: colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, title: { marginTop: 6, color: '#17201b', fontSize: 31, lineHeight:34,fontWeight: '800',letterSpacing:-1 }, subtitle: { marginTop: 7, color: colors.muted,fontSize:12 },
  layout: { gap: 24, alignItems: 'stretch' }, lines: { gap: 10 }, line: { padding: 14, borderWidth:1,borderColor:'#e9edea',borderRadius:18,backgroundColor: colors.surface },lineTop:{flexDirection:'row',alignItems:'flex-start',gap:12}, thumb: { width: 76, height: 76, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primarySoft }, image: { width: '100%', height: '100%', resizeMode: 'cover' }, lineCopy: { flex: 1, minWidth: 0 }, lineName: { color: colors.ink, fontSize: 14, lineHeight:18,fontWeight: '800' },variant:{marginTop:4,color:colors.primaryDark,fontSize:10,fontWeight:'800'}, unitPrice: { marginTop: 4, color: colors.muted, fontSize: 10 }, removeButton: { width:38,height:38,alignItems:'center',justifyContent:'center' },lineBottom:{marginTop:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, quantity: { height:38,flexDirection: 'row', alignItems: 'center', borderWidth:1,borderColor:'#e1e6e2',borderRadius: radii.pill }, quantityButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, quantityText: { minWidth: 28, color: colors.ink, textAlign: 'center', fontWeight: '900' }, lineTotal: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  summary: { padding: 20, borderRadius: 20, backgroundColor: '#f4f6f4' }, summaryTitle: { marginBottom: 18, color: colors.ink, fontSize: 19, fontWeight: '800' }, row: { marginBottom: 13, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, label: { color: colors.muted,fontSize:12 }, value: { color: colors.ink,fontSize:12,fontWeight: '800' }, pending: { color: colors.primary, fontSize: 12, fontWeight: '800' }, divider: { height: 1, marginBottom: spacing.md, backgroundColor: colors.line }, totalLabel: { color: colors.ink, fontSize: 15, fontWeight: '800' }, total: { color: colors.ink, fontSize: 20, fontWeight: '900' }, primary: { minHeight: 52, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 15, backgroundColor: colors.primary }, primaryText: { color: colors.surface, fontWeight: '900' }, secure: { marginTop: spacing.md, color: colors.muted, lineHeight:15,fontSize: 9, textAlign: 'center' },
  empty: { alignItems: 'center', padding: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface }, emptyIcon: { width: 86, height: 86, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: colors.primarySoft }, emptyTitle: { marginTop: spacing.lg, color: colors.ink, fontSize: 24, fontWeight: '900' }, emptyText: { marginTop: spacing.sm, color: colors.muted },
});
