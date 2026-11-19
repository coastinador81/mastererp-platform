import Ionicons from '@expo/vector-icons/Ionicons';
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
    <View style={styles.intro}><Text style={styles.eyebrow}>OFERTAS</Text><Text style={styles.title}>Precios para aprovechar</Text><Text style={styles.subtitle}>Promociones vigentes configuradas por esta tienda.</Text></View>
    {offers.length ? <View style={styles.offerSummary}><View style={styles.offerIcon}><Ionicons name="sparkles-outline" size={22} color={colors.primaryDark} /></View><View style={styles.offerCopy}><Text style={styles.offerCount}>{offers.length} {offers.length === 1 ? 'producto en oferta' : 'productos en oferta'}</Text><Text style={styles.offerHint}>El descuento ya está aplicado en cada precio.</Text></View></View> : null}
    {offers.length ? <View style={styles.products}>{offers.map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View>
      : <View style={styles.empty}><View style={styles.icon}><Ionicons name="pricetag-outline" size={34} color={colors.primaryDark} /></View><Text style={styles.emptyTitle}>No hay ofertas activas</Text><Text style={styles.emptyText}>Cuando la tienda publique promociones reales, aparecerán aquí.</Text></View>}
  </Screen>;
}

const styles = StyleSheet.create({
  intro: { paddingTop: 30, paddingBottom: 18 },
  eyebrow: { color: colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 6, color: '#17201b', fontSize: 31, lineHeight: 35, fontWeight: '800', letterSpacing: -1 },
  subtitle: { marginTop: 7, color: colors.muted, fontSize: 12 },
  offerSummary: { marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#edf4ed' },
  offerIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surface },
  offerCopy: { flex: 1 }, offerCount: { color: colors.ink, fontSize: 13, fontWeight: '900' }, offerHint: { marginTop: 2, color: colors.muted, fontSize: 10 },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  empty: { marginTop: spacing.lg, alignItems: 'center', padding: 40, borderRadius: radii.lg, backgroundColor: '#f4f6f4' },
  icon: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: colors.primarySoft },
  emptyTitle: { marginTop: spacing.md, color: colors.ink, fontSize: 20, fontWeight: '900' },
  emptyText: { maxWidth: 320, marginTop: spacing.xs, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
