import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ImageBackground, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Screen } from '@/components/Screen';
import { ShoppingAssistant } from '@/components/ShoppingAssistant';
import { ProductCard } from '@/components/ProductCard';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';

const categoryImages = ['/storefront/cat-frutas.jpg', '/storefront/cat-despensa.jpg', '/storefront/cat-hogar.jpg'];

export default function HomePage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { catalog, loading, error } = useStore();
  const cardWidth = width < 620 ? '47%' : width < 940 ? '31%' : '23%';
  if (loading) return <Screen><Text style={styles.message}>Preparando tu tienda…</Text></Screen>;
  if (!catalog) return <Screen><Text style={styles.error}>{error || 'No se pudo abrir la tienda.'}</Text></Screen>;
  return <Screen>
    <View style={styles.intro}><Text style={styles.eyebrow}>Buenas tardes</Text><Text style={styles.title}>¿Qué necesitas hoy?</Text></View>
    <ShoppingAssistant />
    <View style={styles.heading}><Text style={styles.sectionTitle}>Explora por categoría</Text><Pressable onPress={() => router.push('/catalog')}><Text style={styles.seeAll}>Ver todas</Text></Pressable></View>
    <View style={styles.categories}>{catalog.categories.slice(0, 6).map((category, index) => <Pressable key={category.slug} style={styles.category} onPress={() => router.push({ pathname: '/catalog', params: { category: category.slug } })}>
      <ImageBackground source={{ uri: categoryImages[index % categoryImages.length] }} style={styles.categoryImage} imageStyle={styles.categoryRadius}><View style={styles.categoryShade} /><View style={styles.categoryFooter}><Text style={styles.categoryName} numberOfLines={2}>{category.name}</Text><Ionicons name="chevron-forward" size={17} color={colors.primary} /></View></ImageBackground>
    </Pressable>)}</View>
    <ImageBackground source={{ uri: '/storefront/hero-market.jpg' }} style={styles.promo} imageStyle={styles.promoRadius}><View style={styles.promoShade} /><View style={styles.promoCopy}><Text style={styles.promoEyebrow}>CALIDAD QUE TE ACOMPAÑA</Text><Text style={styles.promoTitle}>{catalog.store.configuration?.headline || 'Fresco y local'}</Text><Text style={styles.promoText}>Encuentra tus productos favoritos y recíbelos donde estés.</Text><Pressable style={styles.promoButton} onPress={() => router.push('/catalog')}><Text style={styles.promoButtonText}>Ver productos</Text><Ionicons name="arrow-forward" size={16} color={colors.primaryDark} /></Pressable></View></ImageBackground>
    <View style={styles.heading}><Text style={styles.sectionTitle}>Productos destacados</Text></View>
    <View style={styles.products}>{catalog.products.slice(0, 8).map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View>
  </Screen>;
}

const styles = StyleSheet.create({
  message: { marginTop: 80, color: colors.muted, textAlign: 'center' }, error: { marginTop: 80, color: colors.danger, textAlign: 'center' }, intro: { paddingTop: 30 }, eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '800' }, title: { marginTop: 6, color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: '900', letterSpacing: -1.4 },
  heading: { marginTop: 32, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', letterSpacing: -0.7 }, seeAll: { color: colors.primaryDark, fontWeight: '800' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, category: { flexGrow: 1, minWidth: 138, maxWidth: 220, height: 165, overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.surface }, categoryImage: { flex: 1, justifyContent: 'flex-end' }, categoryRadius: { borderRadius: radii.md }, categoryShade: { position: 'absolute', inset: 0, backgroundColor: '#0b1f331f' }, categoryFooter: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: 10, backgroundColor: '#fffffff2' }, categoryName: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '900' },
  promo: { minHeight: 260, marginTop: 18, overflow: 'hidden', justifyContent: 'center', borderRadius: radii.lg }, promoRadius: { borderRadius: radii.lg }, promoShade: { position: 'absolute', inset: 0, width: '72%', backgroundColor: '#157a3ae8' }, promoCopy: { width: '72%', padding: spacing.lg }, promoEyebrow: { color: colors.surface, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, promoTitle: { marginTop: 7, color: colors.surface, fontSize: 31, fontWeight: '900' }, promoText: { maxWidth: 400, marginTop: 6, color: '#ffffffdc', lineHeight: 21 }, promoButton: { alignSelf: 'flex-start', marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: radii.pill, backgroundColor: colors.surface }, promoButtonText: { color: colors.primaryDark, fontWeight: '900' }, products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
