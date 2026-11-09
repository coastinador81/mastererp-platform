import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';
import type { Product } from '../types';
import { useStore } from '../store/StoreProvider';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);

export function ProductCard({ product, width }: { product: Product; width: number | string }) {
  const router = useRouter();
  const { add } = useStore();
  const available = product.available > 0;
  const price = product.offer_price != null && product.offer_price < product.price ? product.offer_price : product.price;
  const onOffer = price < product.price;
  return (
    <Pressable style={[styles.card, { width }]} onPress={() => router.push(`/product/${product.id}`)}>
      <View style={styles.imageWrap}>
        {product.image_url ? <Image source={{ uri: product.image_url }} style={styles.image} /> : <Ionicons name="basket-outline" size={48} color={colors.primary} />}
        <View style={[styles.stock, onOffer && styles.offer]}><Text style={[styles.stockText, onOffer && styles.offerText]}>{onOffer ? 'Oferta' : available ? 'Disponible' : 'Agotado'}</Text></View>
      </View>
      <View style={styles.copy}>
        <Text style={styles.brand}>{product.brand_ref || 'Selección de la tienda'}</Text>
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.description} numberOfLines={2}>{product.description || 'Producto disponible en tu tienda.'}</Text>
        <View style={styles.bottom}>
          <View>{onOffer ? <Text style={styles.oldPrice}>{money(product.price)}</Text> : null}<Text style={styles.price}>{money(price)}</Text></View>
          <Pressable
            style={[styles.add, !available && styles.disabled]}
            disabled={!available}
            onPress={event => { event.stopPropagation(); add(product); }}
            accessibilityLabel={`Agregar ${product.name}`}
          ><Ionicons name="add" size={23} color={colors.surface} /></Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, shadowColor: colors.ink, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  imageWrap: { height: 170, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  stock: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.surface },
  stockText: { color: colors.success, fontSize: 10, fontWeight: '900' },
  offer: { backgroundColor: colors.offer },
  offerText: { color: colors.surface },
  copy: { padding: spacing.md },
  brand: { color: colors.primary, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  name: { minHeight: 44, marginTop: 5, color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  description: { minHeight: 38, marginTop: 5, color: colors.muted, fontSize: 12, lineHeight: 18 },
  bottom: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  oldPrice: { color: colors.muted, fontSize: 11, textDecorationLine: 'line-through' },
  add: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primary },
  disabled: { opacity: 0.4 },
});
