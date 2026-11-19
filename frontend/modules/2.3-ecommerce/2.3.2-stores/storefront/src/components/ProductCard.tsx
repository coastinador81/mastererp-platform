import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../theme';
import type { Product, ProductVariant } from '../types';
import { useStore } from '../store/StoreProvider';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);
const variantLabel = (variant: ProductVariant) => variant.label || Object.values(variant.values || {}).join(' / ') || variant.sku || 'Combinación';

export function ProductCard({ product, width, featured = false }: { product: Product; width: number | string; featured?: boolean }) {
  const router = useRouter();
  const { add } = useStore();
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const available = product.available > 0;
  const price = product.offer_price != null && product.offer_price < product.price ? product.offer_price : product.price;
  const onOffer = price < product.price;
  const discount = onOffer ? Math.round((1 - price / product.price) * 100) : 0;
  const variants = (product.attributes?._catalog?.variants || []).filter(variant => variant.active !== false);
  const selectedVariant = variants.find(variant => variant.key === selectedKey);
  const quickAdd = () => variants.length ? setVariantsOpen(true) : add(product);
  const addVariant = () => {
    if (!selectedVariant) return;
    add(product, 1, selectedVariant);
    setVariantsOpen(false);
    setSelectedKey('');
  };
  return <>
    <Pressable style={[styles.card, featured && styles.featuredCard, { width }]} onPress={() => router.push(`/product/${product.id}`)}>
      <View style={[styles.imageWrap, featured && styles.featuredImage]}>
        {product.image_url ? <Image source={{ uri: product.image_url }} style={styles.image} /> : <Ionicons name="basket-outline" size={48} color={colors.primary} />}
        {onOffer ? <View style={styles.offer}><Text style={styles.offerText}>{discount > 0 ? `-${discount}%` : 'Oferta'}</Text></View> : null}
        <Pressable
          style={[styles.add, !available && styles.disabled]}
          disabled={!available}
          onPress={event => { event.stopPropagation(); quickAdd(); }}
          accessibilityLabel={variants.length ? `Elegir combinación de ${product.name}` : `Agregar ${product.name}`}
        ><Ionicons name={variants.length ? 'options-outline' : 'add'} size={21} color={colors.surface} /></Pressable>
      </View>
      <View style={[styles.copy, featured && styles.featuredCopy]}>
        <View style={styles.meta}><View style={styles.availability}><View style={[styles.dot, !available && styles.dotUnavailable]} /><Text style={[styles.availabilityText, !available && styles.unavailableText]}>{available ? 'Disponible' : 'Agotado'}</Text></View>{product.brand_ref ? <Text style={styles.brand} numberOfLines={1}>{product.brand_ref}</Text> : null}</View>
        <Text style={[styles.name, featured && styles.featuredName]} numberOfLines={2}>{product.name}</Text>
        <View style={styles.bottom}>
          <Text style={styles.price}>{money(price)}</Text>
          {onOffer ? <Text style={styles.oldPrice}>{money(product.price)}</Text> : null}
        </View>
      </View>
    </Pressable>
    <Modal visible={variantsOpen} transparent animationType="fade" onRequestClose={() => setVariantsOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setVariantsOpen(false)}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.sheetHeading}><View style={styles.sheetHeadingCopy}><Text style={styles.sheetEyebrow}>ELIGE UNA COMBINACIÓN</Text><Text style={styles.sheetTitle}>{product.name}</Text></View><Pressable style={styles.close} onPress={() => setVariantsOpen(false)} accessibilityLabel="Cerrar selector"><Ionicons name="close" size={20} color={colors.ink} /></Pressable></View>
          <View style={styles.variantList}>{variants.map(variant => {
            const selected = variant.key === selectedKey;
            const variantPrice = price + Number(variant.price_delta || 0);
            return <Pressable key={variant.key} style={[styles.variant, selected && styles.variantSelected]} onPress={() => setSelectedKey(variant.key)} accessibilityRole="radio" accessibilityState={{ selected }}><View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View><View style={styles.variantCopy}><Text style={[styles.variantName, selected && styles.variantNameSelected]}>{variantLabel(variant)}</Text>{variant.sku ? <Text style={styles.variantSku}>SKU {variant.sku}</Text> : null}</View><Text style={styles.variantPrice}>{money(variantPrice)}</Text></Pressable>;
          })}</View>
          <Pressable style={[styles.confirm, !selectedVariant && styles.confirmDisabled]} disabled={!selectedVariant} onPress={addVariant}><Text style={styles.confirmText}>{selectedVariant ? `Agregar · ${money(price + Number(selectedVariant.price_delta || 0))}` : 'Selecciona una combinación'}</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 18 }, featuredCard: { borderWidth: 1, borderColor: '#e9edea', shadowColor: '#132a1c', shadowOpacity: .06, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  imageWrap: { height: 158, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#f4f6f4' }, featuredImage: { height: 176, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  offer: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.surface }, offerText: { color: colors.primaryDark, fontSize: 10, fontWeight: '900' },
  add: { position: 'absolute', right: 10, bottom: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface, borderRadius: 20, backgroundColor: colors.primary }, disabled: { opacity: 0.45 },
  copy: { paddingTop: 8, paddingHorizontal: 3, paddingBottom: 10 }, featuredCopy: { paddingHorizontal: 14, paddingBottom: 14 },
  meta: { minHeight: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  availability: { flexDirection: 'row', alignItems: 'center', gap: 5 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }, dotUnavailable: { backgroundColor: colors.muted }, availabilityText: { color: colors.success, fontSize: 9, fontWeight: '800' }, unavailableText: { color: colors.muted },
  brand: { flexShrink: 1, color: colors.primaryDark, fontSize: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'right' },
  name: { marginTop: 4, color: '#17201b', fontSize: 13, lineHeight: 18, fontWeight: '800' }, featuredName: { fontSize: 16, lineHeight: 21 },
  bottom: { marginTop: 6, flexDirection: 'row', alignItems: 'baseline', gap: 8 }, price: { color: '#17201b', fontSize: 16, fontWeight: '900' }, oldPrice: { color: colors.muted, fontSize: 10, textDecorationLine: 'line-through' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#08160e75' }, sheet: { width: '100%', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface }, handle: { width: 38, height: 4, alignSelf: 'center', marginTop: 2, marginBottom: 14, borderRadius: 2, backgroundColor: '#dce2de' },
  sheetHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 }, sheetHeadingCopy: { flex: 1 }, sheetEyebrow: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, sheetTitle: { marginTop: 4, color: colors.ink, fontSize: 21, lineHeight: 26, fontWeight: '800' }, close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#f2f5f3' },
  variantList: { gap: 9 }, variant: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: '#e4e9e5', borderRadius: 16 }, variantSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, radio: { width: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.line, borderRadius: 10 }, radioSelected: { borderColor: colors.primary }, radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary }, variantCopy: { flex: 1 }, variantName: { color: colors.ink, fontSize: 13, fontWeight: '800' }, variantNameSelected: { color: colors.primaryDark }, variantSku: { marginTop: 3, color: colors.muted, fontSize: 9 }, variantPrice: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  confirm: { minHeight: 50, marginTop: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: colors.primary }, confirmDisabled: { opacity: .45 }, confirmText: { color: colors.surface, fontSize: 13, fontWeight: '900' },
});
