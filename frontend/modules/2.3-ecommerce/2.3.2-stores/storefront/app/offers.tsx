import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';
import { useLayoutWidth } from '@/useLayoutWidth';

export default function OffersPage() {
  const width = useLayoutWidth();
  const { catalog } = useStore();
  const offers = (catalog?.products || []).filter(product => product.offer_price != null && product.offer_price < product.price);
  const cardWidth = width < 520 ? '47%' : '31%';
  return <Screen>
    <View style={styles.intro}><Text style={styles.eyebrow}>OFERTAS</Text><Text style={styles.title}>Ahorra en tus favoritos</Text><Text style={styles.subtitle}>Promociones vigentes configuradas por esta tienda.</Text></View>
    {offers.length ? <View style={styles.products}>{offers.map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View>
      : <View style={styles.empty}><View style={styles.icon}><Ionicons name="pricetag-outline" size={34} color={colors.primaryDark} /></View><Text style={styles.emptyTitle}>No hay ofertas activas</Text><Text style={styles.emptyText}>Cuando la tienda publique promociones reales, aparecerán aquí.</Text></View>}
  </Screen>;
}

const styles = StyleSheet.create({
  intro: { paddingTop: 42, paddingBottom: spacing.lg },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 6, color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  subtitle: { marginTop: 8, color: colors.muted, fontSize: 15 },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  empty: { marginTop: spacing.lg, alignItems: 'center', padding: spacing.xl, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  icon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.primarySoft },
  emptyTitle: { marginTop: spacing.md, color: colors.ink, fontSize: 20, fontWeight: '900' },
  emptyText: { maxWidth: 320, marginTop: spacing.xs, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
