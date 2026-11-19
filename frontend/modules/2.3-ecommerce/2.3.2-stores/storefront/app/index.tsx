import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ShoppingAssistant } from '@/components/ShoppingAssistant';
import { ProductCard } from '@/components/ProductCard';
import { AppLoading } from '@/components/AppLoading';
import { useStore } from '@/store/StoreProvider';
import { useLayoutWidth } from '@/useLayoutWidth';
import { loadProfile } from '@/api';
import { colors, radii, spacing } from '@/theme';
import type { Category, Product } from '@/types';

const greeting = (hour = new Date().getHours()) => hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

export default function HomePage() {
  const router = useRouter();
  const width = useLayoutWidth();
  const { catalog, loading, error, authenticated, refreshCatalog } = useStore();
  const [profileName, setFirstName] = useState('');
  const [query, setQuery] = useState('');
  const firstName = authenticated ? profileName : '';
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    void loadProfile()
      .then(profile => { if (active) setFirstName(profile.name?.trim().split(/\s+/)[0] || ''); })
      .catch(() => { if (active) setFirstName(''); });
    return () => { active = false; };
  }, [authenticated]);
  const cardWidth = width < 520 ? 270 : 300;
  const offers = catalog?.products.filter(product => product.offer_price != null && product.offer_price < product.price) || [];
  const showcase = offers.length ? offers.slice(0, 4) : catalog?.products.slice(0, 4) || [];
  const search = () => router.push({ pathname: '/catalog', params: query.trim() ? { q: query.trim() } : undefined });
  if (loading) return <Screen><AppLoading title="Cargando productos…" detail="Consultando precios y disponibilidad." /></Screen>;
  if (!catalog) return <Screen><View style={styles.loadError}><Ionicons name="cloud-offline-outline" size={34} color={colors.danger} /><Text style={styles.error}>{error || 'No se pudo abrir la tienda.'}</Text><Pressable style={styles.retry} onPress={() => void refreshCatalog()}><Text style={styles.retryText}>Reintentar</Text></Pressable></View></Screen>;
  return <Screen>
    <ImageBackground source={{ uri: '/storefront/hero-market.jpg' }} style={styles.hero} imageStyle={styles.heroImage}>
      <View style={styles.heroOverlay} />
      <View style={styles.heroCopy}><Text style={styles.eyebrow}>{firstName ? `${greeting()}, ${firstName}` : greeting()}</Text><Text style={styles.title}>Lo fresco llega a tu mesa.</Text><Text style={styles.subtitle}>Compra fácil. Recibe productos de tu tienda y nodo seleccionados.</Text><Pressable style={styles.heroAction} onPress={() => router.push('/catalog')}><Text style={styles.heroActionText}>Explorar productos</Text><Ionicons name="arrow-forward" size={16} color={colors.surface} /></Pressable></View>
    </ImageBackground>
    <View style={styles.search}><Ionicons name="search-outline" size={20} color={colors.primaryDark} /><TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" placeholder="Busca productos, categorías u ofertas" placeholderTextColor={colors.muted} style={styles.searchInput} /><Pressable style={styles.searchButton} onPress={search} accessibilityLabel="Buscar"><Ionicons name="arrow-forward" size={17} color={colors.surface} /></Pressable></View>
    <View style={styles.heading}><Text style={styles.sectionTitle}>Explora por categoría</Text><Pressable onPress={() => router.push('/catalog')}><Text style={styles.seeAll}>Ver todas</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{catalog.categories.map(category => <CategoryTile key={category.slug} category={category} products={catalog.products} onPress={() => router.push({ pathname: '/catalog', params: { category: category.slug } })} />)}</ScrollView>
    <ShoppingAssistant />
    <View style={styles.heading}><View><Text style={styles.sectionTitle}>{offers.length ? 'Ofertas de la semana' : 'Descubre productos'}</Text><Text style={styles.sectionHint}>{offers.length ? 'Precios especiales disponibles ahora.' : 'Disponibles en el nodo seleccionado.'}</Text></View><Pressable onPress={() => router.push(offers.length ? '/offers' : '/catalog')}><Text style={styles.seeAll}>Ver todos</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardWidth + 12} decelerationRate="fast" contentContainerStyle={styles.products}>{showcase.map(product => <ProductCard key={product.id} product={product} width={cardWidth} featured />)}</ScrollView>
  </Screen>;
}

function CategoryTile({ category, products, onPress }: { category: Category; products: Product[]; onPress: () => void }) {
  const imageUrl = category.image_url || products.find(product => product.category_ref === category.slug && product.image_url)?.image_url;
  return <Pressable style={styles.category} onPress={onPress}>
    {imageUrl ? <ImageBackground source={{ uri: imageUrl }} style={styles.categoryImage} imageStyle={styles.categoryRadius}><View style={styles.categoryShade} /></ImageBackground> : <View style={styles.categoryFallback}><Ionicons name="basket-outline" size={28} color={colors.primaryDark} /></View>}
    <View style={styles.categoryFooter}><Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text><Ionicons name="arrow-forward" size={14} color={colors.primaryDark} /></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  loadError: { minHeight: 320, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, error: { maxWidth: 300, marginTop: spacing.sm, color: colors.danger, textAlign: 'center' }, retry: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, borderRadius: radii.pill, backgroundColor: colors.primary }, retryText: { color: colors.surface, fontWeight: '900' },
  hero: { minHeight: 268, marginTop: 16, overflow: 'hidden', justifyContent: 'center', borderRadius: 28 }, heroImage: { borderRadius: 28 }, heroOverlay: { position: 'absolute', inset: 0, backgroundColor: '#092118a8' }, heroCopy: { width: '78%', padding: 24 }, eyebrow: { color: '#a7efc6', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }, title: { marginTop: 7, color: colors.surface, fontSize: 34, lineHeight: 36, fontWeight: '800', letterSpacing: -1.4 }, subtitle: { marginTop: 10, color: '#e1ece5', fontSize: 12, lineHeight: 19 }, heroAction: { minHeight: 43, alignSelf: 'flex-start', marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.primary }, heroActionText: { color: colors.surface, fontSize: 12, fontWeight: '800' },
  search: { zIndex: 2, minHeight: 56, marginTop: -28, marginHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 16, paddingRight: 6, borderWidth: 1, borderColor: '#e8ede9', borderRadius: 18, backgroundColor: colors.surface, shadowColor: '#132a1c', shadowOpacity: .1, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }, searchInput: { flex: 1, color: colors.ink, fontSize: 12, outlineStyle: 'none' } as never, searchButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  heading: { marginTop: 30, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: '#17201b', fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }, sectionHint: { marginTop: 3, color: '#717b75', fontSize: 10 }, seeAll: { minHeight: 42, paddingHorizontal: 4, textAlignVertical: 'center', color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  categories: { gap: 10, paddingRight: spacing.md }, category: { width: 122, height: 128, overflow: 'hidden', borderWidth: 1, borderColor: '#e9edea', borderRadius: 20, backgroundColor: colors.surface }, categoryImage: { height: 88 }, categoryRadius: { borderTopLeftRadius: 20, borderTopRightRadius: 20 }, categoryShade: { position: 'absolute', inset: 0, backgroundColor: '#0b1f330d' }, categoryFallback: { height: 88, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, categoryFooter: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, paddingHorizontal: 11, backgroundColor: colors.surface }, categoryName: { flex: 1, color: '#17201b', fontSize: 11, fontWeight: '800' },
  products: { gap: 12, paddingRight: spacing.md, paddingBottom: 8 },
});
