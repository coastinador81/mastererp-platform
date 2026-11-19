import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);

export default function ProductPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { catalog, add } = useStore();
  const [quantity, setQuantity] = useState(1);
  const [variantKey, setVariantKey] = useState('');
  const product = catalog?.products.find(item => item.id === id);
  if (!product) return <Screen><View style={styles.empty}><Text style={styles.title}>Producto no disponible</Text><Pressable onPress={() => router.replace('/catalog')}><Text style={styles.backLink}>Volver al catálogo</Text></Pressable></View></Screen>;
  const available = product.available > 0;
  const maxQuantity = Math.max(1, product.available);
  const price = product.offer_price != null && product.offer_price < product.price ? product.offer_price : product.price;
  const onOffer = price < product.price;
  const variants = (product.attributes?._catalog?.variants || []).filter(item => item.active !== false);
  const selectedVariant = variants.find(item => item.key === variantKey);
  const requiresVariant = variants.length > 0;
  const finalPrice = price + Number(selectedVariant?.price_delta || 0);
  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={19} color={colors.primaryDark} /><Text style={styles.backText}>Volver</Text></Pressable>
      <View style={styles.layout}>
        <View style={styles.imageWrap}>{product.image_url ? <Image source={{ uri: product.image_url }} style={styles.image} /> : <Ionicons name="basket-outline" size={82} color={colors.primary} />}</View>
        <View style={styles.copy}>
          <View style={styles.availability}><View style={[styles.dot,!available&&styles.dotUnavailable]}/><Text style={[styles.availabilityText, !available && styles.unavailable]}>{available ? 'Disponible' : 'No disponible por ahora'}</Text></View>
          {product.brand_ref ? <Text style={styles.eyebrow}>{product.brand_ref}</Text> : null}
          <Text style={styles.title}>{product.name}</Text>
          <Text style={styles.description}>{product.description || 'Producto seleccionado y disponible para tu compra.'}</Text>
          <View style={styles.priceRow}><Text style={[styles.price, onOffer && styles.offerPrice]}>{money(finalPrice)}</Text>{onOffer ? <Text style={styles.originalPrice}>{money(product.price + Number(selectedVariant?.price_delta || 0))}</Text> : null}</View>
          {requiresVariant ? <View style={styles.variants}><Text style={styles.variantTitle}>Elige una combinación</Text><View style={styles.variantOptions}>{variants.map(item => <Pressable key={item.key} style={[styles.variantOption,variantKey===item.key&&styles.variantSelected]} onPress={()=>setVariantKey(item.key)} accessibilityRole="radio" accessibilityState={{selected:variantKey===item.key}}><Text style={[styles.variantText,variantKey===item.key&&styles.variantTextSelected]}>{item.label || Object.values(item.values || {}).join(' / ') || item.sku || 'Combinación'}</Text>{item.price_delta ? <Text style={styles.variantDelta}>{item.price_delta>0?'+':''}{money(item.price_delta)}</Text>:null}</Pressable>)}</View></View> : null}
          <View style={styles.quantityRow}><Text style={styles.quantityLabel}>Cantidad</Text><View style={styles.stepper}><Pressable style={styles.stepButton} disabled={quantity <= 1} onPress={() => setQuantity(value => Math.max(1, value - 1))} accessibilityLabel="Disminuir cantidad"><Ionicons name="remove" size={18} color={quantity <= 1 ? colors.line : colors.ink} /></Pressable><Text style={styles.quantity}>{quantity}</Text><Pressable style={styles.stepButton} disabled={!available || quantity >= maxQuantity} onPress={() => setQuantity(value => Math.min(maxQuantity, value + 1))} accessibilityLabel="Aumentar cantidad"><Ionicons name="add" size={18} color={!available || quantity >= maxQuantity ? colors.line : colors.ink} /></Pressable></View></View>
          <Pressable style={[styles.add, (!available || (requiresVariant&&!selectedVariant)) && styles.disabled]} disabled={!available || (requiresVariant&&!selectedVariant)} onPress={() => { add(product, quantity, selectedVariant); router.push('/cart'); }}><Ionicons name="bag-add-outline" size={22} color={colors.surface} /><Text style={styles.addText}>{!available ? 'Producto agotado' : requiresVariant&&!selectedVariant ? 'Selecciona una combinación' : `Agregar ${quantity} al carrito`}</Text></Pressable>
          <View style={styles.trust}><Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} /><View style={styles.trustCopy}><Text style={styles.trustTitle}>Compra protegida por MasterERP</Text><Text style={styles.trustText}>El precio y el inventario se validan nuevamente al crear tu pedido.</Text></View></View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', marginTop: 14, minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, backText: { color: colors.ink, fontSize: 11, fontWeight: '800' }, backLink: { marginTop: spacing.md, color: colors.primary, fontWeight: '800' },
  layout: { flexDirection: 'column', gap: 0 }, imageWrap: { width: '100%', height: 325, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 24, backgroundColor: colors.primarySoft }, image: { width: '100%', height: '100%', resizeMode: 'cover' }, copy: { width: '100%', paddingHorizontal: 7, paddingTop: 22, paddingBottom: 28 }, eyebrow: { marginTop: 10, color: colors.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform:'uppercase' }, title: { marginTop: 7, color: '#17201b', fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -1 }, description: { marginTop: 7, color: '#707b74', fontSize: 12, lineHeight: 19 }, availability: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot:{width:7,height:7,borderRadius:4,backgroundColor:colors.success},dotUnavailable:{backgroundColor:colors.danger},availabilityText: { color: colors.success, fontSize:10,fontWeight: '800' }, unavailable: { color: colors.danger },
  priceRow: { marginTop: 18, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }, price: { color: colors.ink, fontSize: 25, fontWeight: '900' }, offerPrice: { color: colors.primaryDark }, originalPrice: { color: colors.muted, fontSize: 11, textDecorationLine: 'line-through' },
  variants:{marginTop:20,gap:spacing.sm},variantTitle:{color:colors.ink,fontSize:12,fontWeight:'800'},variantOptions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},variantOption:{minHeight:44,justifyContent:'center',paddingHorizontal:spacing.md,paddingVertical:spacing.sm,borderWidth:1,borderColor:'#e1e6e2',borderRadius:14,backgroundColor:colors.surface},variantSelected:{borderColor:colors.primary,backgroundColor:colors.primarySoft},variantText:{color:colors.ink,fontSize:12,fontWeight:'800'},variantTextSelected:{color:colors.primaryDark},variantDelta:{marginTop:2,color:colors.muted,fontSize:10},
  quantityRow: { minHeight: 56, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, quantityLabel: { color: colors.ink, fontWeight: '800' }, stepper: { height: 40, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill }, stepButton: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center' }, quantity: { width: 34, color: colors.ink, textAlign: 'center', fontWeight: '900' },
  add: { marginTop: spacing.sm, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: 15, backgroundColor: colors.primary }, addText: { color: colors.surface, fontSize: 14, fontWeight: '900' }, disabled: { opacity: 0.45 }, trust: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 14, borderRadius: 16, backgroundColor: '#f4f6f4' }, trustCopy: { flex: 1, minWidth: 0 }, trustTitle: { color: colors.ink, fontSize: 11, fontWeight: '800' }, trustText: { maxWidth: 380, marginTop: 3, color: colors.muted, fontSize: 10,lineHeight:15 }, empty: { marginTop: 80, alignItems: 'center' },
});
