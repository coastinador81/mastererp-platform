import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ImageBackground, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Screen } from '@/components/Screen';
import { ProductCard } from '@/components/ProductCard';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';

const categoryImages = ['/storefront/cat-frutas.jpg', '/storefront/cat-despensa.jpg', '/storefront/cat-hogar.jpg'];

export default function HomePage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { catalog, loading, error } = useStore();
  const cardWidth = width < 620 ? '100%' : width < 940 ? '47%' : '23%';
  if (loading) return <Screen><Text style={styles.message}>Preparando tu tienda…</Text></Screen>;
  if (!catalog) return <Screen><Text style={styles.error}>{error || 'No se pudo abrir la tienda.'}</Text></Screen>;
  return (
    <Screen>
      <ImageBackground source={{ uri: '/storefront/hero-market.jpg' }} style={styles.hero} imageStyle={styles.heroImage}>
        <View style={styles.overlay} />
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>COMPRA FÁCIL · ENTREGA CONFIABLE</Text>
          <Text style={styles.heroTitle}>{catalog.store.configuration?.headline || 'Todo lo que necesitas, más cerca de ti'}</Text>
          <Text style={styles.heroText}>Explora productos disponibles y completa tu pedido con el respaldo de MasterERP.</Text>
          <Pressable style={styles.heroButton} onPress={() => router.push('/catalog')}><Text style={styles.heroButtonText}>Ver catálogo</Text><Ionicons name="arrow-forward" size={18} color={colors.primaryDark} /></Pressable>
        </View>
      </ImageBackground>
      <View style={[styles.heading, width < 620 && styles.headingMobile]}><View><Text style={styles.kicker}>EXPLORA</Text><Text style={styles.title}>Compra por categoría</Text></View><Pressable onPress={() => router.push('/catalog')}><Text style={styles.seeAll}>Ver todas</Text></Pressable></View>
      <View style={styles.categories}>
        {catalog.categories.slice(0, 3).map((category, index) => (
          <Pressable key={category.slug} style={styles.category} onPress={() => router.push({ pathname: '/catalog', params: { category: category.slug } })}>
            <ImageBackground source={{ uri: categoryImages[index % categoryImages.length] }} style={styles.categoryImage} imageStyle={styles.categoryImageRadius}>
              <View style={styles.categoryShade} /><Text style={styles.categoryName}>{category.name}</Text>
            </ImageBackground>
          </Pressable>
        ))}
      </View>
      <View style={styles.heading}><View><Text style={styles.kicker}>PARA TI</Text><Text style={styles.title}>Productos destacados</Text></View></View>
      <View style={styles.products}>{catalog.products.slice(0, 8).map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  message: { marginTop: 80, color: colors.muted, textAlign: 'center' }, error: { marginTop: 80, color: colors.danger, textAlign: 'center' },
  hero: { minHeight: 420, marginTop: spacing.lg, overflow: 'hidden', justifyContent: 'center', borderRadius: radii.lg }, heroImage: { borderRadius: radii.lg }, overlay: { position: 'absolute', inset: 0, backgroundColor: '#102a4dcc' }, heroCopy: { maxWidth: 610, padding: spacing.xl }, eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 }, heroTitle: { marginTop: spacing.sm, color: colors.surface, fontSize: 45, lineHeight: 50, fontWeight: '900', letterSpacing: -1.5 }, heroText: { maxWidth: 520, marginTop: spacing.md, color: '#e4edf7', fontSize: 16, lineHeight: 25 }, heroButton: { alignSelf: 'flex-start', marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 19, paddingVertical: 14, borderRadius: radii.pill, backgroundColor: colors.accent }, heroButtonText: { color: colors.primaryDark, fontWeight: '900' },
  heading: { marginTop: 42, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm }, headingMobile: { alignItems: 'flex-start', flexDirection: 'column' }, kicker: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 }, title: { marginTop: 4, color: colors.ink, fontSize: 27, fontWeight: '900' }, seeAll: { color: colors.primary, fontWeight: '800' },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, category: { flexGrow: 1, minWidth: 220, height: 150 }, categoryImage: { flex: 1, overflow: 'hidden', justifyContent: 'flex-end', padding: spacing.md }, categoryImageRadius: { borderRadius: radii.md }, categoryShade: { position: 'absolute', inset: 0, backgroundColor: '#102a4d66', borderRadius: radii.md }, categoryName: { color: colors.surface, fontSize: 20, fontWeight: '900' },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
