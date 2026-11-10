import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { ShoppingAssistant } from '@/components/ShoppingAssistant';
import { ProductCard } from '@/components/ProductCard';
import { AppLoading } from '@/components/AppLoading';
import { useStore } from '@/store/StoreProvider';
import { useLayoutWidth } from '@/useLayoutWidth';
import { loadProfile } from '@/api';
import { colors, radii, spacing } from '@/theme';

const categoryImages = ['/storefront/cat-frutas.jpg', '/storefront/cat-despensa.jpg', '/storefront/cat-hogar.jpg'];
const greeting = (hour = new Date().getHours()) => hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

export default function HomePage() {
  const router = useRouter();
  const width = useLayoutWidth();
  const { catalog, loading, error, authenticated } = useStore();
  const [profileName, setFirstName] = useState('');
  const firstName = authenticated ? profileName : '';
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    void loadProfile()
      .then(profile => { if (active) setFirstName(profile.name?.trim().split(/\s+/)[0] || ''); })
      .catch(() => { if (active) setFirstName(''); });
    return () => { active = false; };
  }, [authenticated]);
  const cardWidth = width < 520 ? '47%' : '31%';
  if (loading) return <Screen><AppLoading title="Preparando tu tienda…" detail="Estamos cargando productos, precios y disponibilidad." /></Screen>;
  if (!catalog) return <Screen><Text style={styles.error}>{error || 'No se pudo abrir la tienda.'}</Text></Screen>;
  return <Screen>
    <View style={styles.intro}><Text style={styles.eyebrow}>{firstName ? `${greeting()}, ${firstName}` : greeting()}</Text><Text style={styles.title}>¿Qué necesitas hoy?</Text></View>
    <ShoppingAssistant />
    <View style={styles.heading}><Text style={styles.sectionTitle}>Explora por categoría</Text><Pressable onPress={() => router.push('/catalog')}><Text style={styles.seeAll}>Ver todas</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{catalog.categories.map((category, index) => <Pressable key={category.slug} style={styles.category} onPress={() => router.push({ pathname: '/catalog', params: { category: category.slug } })}>
      <ImageBackground source={{ uri: categoryImages[index % categoryImages.length] }} style={styles.categoryImage} imageStyle={styles.categoryRadius}><View style={styles.categoryShade} /><View style={styles.categoryFooter}><Text style={styles.categoryName} numberOfLines={2}>{category.name}</Text><Ionicons name="chevron-forward" size={17} color={colors.primary} /></View></ImageBackground>
    </Pressable>)}</ScrollView>
    <ImageBackground source={{ uri: '/storefront/hero-market.jpg' }} style={styles.promo} imageStyle={styles.promoRadius}><View style={styles.promoShade} /><View style={styles.promoCopy}><Text style={styles.promoEyebrow}>CALIDAD QUE TE ACOMPAÑA</Text><Text style={styles.promoTitle}>{catalog.store.configuration?.headline || 'Fresco y local'}</Text><Text style={styles.promoText}>Encuentra tus productos favoritos y recíbelos donde estés.</Text><Pressable style={styles.promoButton} onPress={() => router.push('/catalog')}><Text style={styles.promoButtonText}>Ver productos</Text><Ionicons name="arrow-forward" size={16} color={colors.primaryDark} /></Pressable></View></ImageBackground>
    <ImageBackground source={{ uri: '/storefront/cat-despensa.jpg' }} style={[styles.promo, styles.offerPromo]} imageStyle={styles.promoRadius}><View style={[styles.promoShade, styles.offerShade]} /><View style={styles.promoCopy}><Text style={[styles.promoEyebrow, styles.offerEyebrow]}>AHORRA TODOS LOS DÍAS</Text><Text style={[styles.promoTitle, styles.offerTitle]}>Ofertas de la semana</Text><Text style={[styles.promoText, styles.offerText]}>Promociones reales publicadas por esta tienda.</Text><Pressable style={[styles.promoButton, styles.offerButton]} onPress={() => router.push('/offers')}><Text style={[styles.promoButtonText, styles.offerButtonText]}>Ver ofertas</Text><Ionicons name="arrow-forward" size={16} color={colors.surface} /></Pressable></View></ImageBackground>
    <View style={styles.heading}><Text style={styles.sectionTitle}>Productos destacados</Text></View>
    <View style={styles.products}>{catalog.products.slice(0, 8).map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View>
  </Screen>;
}

const styles = StyleSheet.create({
  error: { marginTop: 80, color: colors.danger, textAlign: 'center' }, intro: { paddingTop: 30 }, eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '800' }, title: { marginTop: 6, color: colors.ink, fontSize: 36, lineHeight: 40, fontWeight: '900', letterSpacing: -1.4 },
  heading: { marginTop: 32, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', letterSpacing: -0.7 }, seeAll: { color: colors.primaryDark, fontWeight: '800' },
  categories: { gap: 10, paddingRight: spacing.md }, category: { width: 138, height: 165, overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.surface }, categoryImage: { flex: 1, justifyContent: 'flex-end' }, categoryRadius: { borderRadius: radii.md }, categoryShade: { position: 'absolute', inset: 0, backgroundColor: '#0b1f331f' }, categoryFooter: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: 10, backgroundColor: '#fffffff2' }, categoryName: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '900' },
  promo: { minHeight: 230, marginTop: 18, overflow: 'hidden', justifyContent: 'center', borderRadius: radii.lg }, promoRadius: { borderRadius: radii.lg }, promoShade: { position: 'absolute', inset: 0, width: '78%', backgroundColor: '#157a3aeb' }, promoCopy: { width: '78%', padding: spacing.lg }, promoEyebrow: { color: colors.surface, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, promoTitle: { marginTop: 7, color: colors.surface, fontSize: 29, fontWeight: '900' }, promoText: { maxWidth: 400, marginTop: 6, color: '#ffffffdc', lineHeight: 21 }, promoButton: { alignSelf: 'flex-start', marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: radii.pill, backgroundColor: colors.surface }, promoButtonText: { color: colors.primaryDark, fontWeight: '900' },
  offerPromo: { backgroundColor: '#ffedc6' }, offerShade: { backgroundColor: '#ffedc6f2' }, offerEyebrow: { color: colors.ink }, offerTitle: { color: colors.ink }, offerText: { color: colors.text }, offerButton: { backgroundColor: colors.primary }, offerButtonText: { color: colors.surface },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
