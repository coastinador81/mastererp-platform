import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { ProductCard } from '@/components/ProductCard';
import { useStore } from '@/store/StoreProvider';
import { useLayoutWidth } from '@/useLayoutWidth';
import { colors, radii, spacing } from '@/theme';

export default function CatalogPage() {
  const params = useLocalSearchParams<{ category?: string; q?: string; offers?: string }>();
  const width = useLayoutWidth();
  const { catalog } = useStore();
  const [category, setCategory] = useState(params.category || '');
  const [query, setQuery] = useState(params.q || '');
  const products = useMemo(() => (catalog?.products || []).filter(product => {
    const matchesCategory = !category || product.category_ref === category;
    const term = query.trim().toLocaleLowerCase('es');
    const matchesQuery = !term || `${product.name} ${product.description || ''} ${product.brand_ref || ''}`.toLocaleLowerCase('es').includes(term);
    const matchesOffers = params.offers !== '1' || product.price > 0;
    return matchesCategory && matchesQuery && matchesOffers;
  }), [catalog?.products, category, params.offers, query]);
  const cardWidth = width < 520 ? '47%' : '31%';
  return (
    <Screen>
      <View style={styles.intro}><Text style={styles.eyebrow}>CATÁLOGO</Text><Text style={styles.title}>Encuentra lo que necesitas</Text><Text style={styles.subtitle}>Disponibilidad y precios actualizados para esta tienda.</Text></View>
      <View style={styles.search}><Ionicons name="search" size={20} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Buscar productos…" placeholderTextColor={colors.muted} style={styles.input} /></View>
      <View style={styles.filters}>
        <Pressable style={[styles.filter, !category && styles.filterActive]} onPress={() => setCategory('')}><Text style={[styles.filterText, !category && styles.filterTextActive]}>Todos</Text></Pressable>
        {catalog?.categories.map(item => <Pressable key={item.slug} style={[styles.filter, category === item.slug && styles.filterActive]} onPress={() => setCategory(item.slug)}><Text style={[styles.filterText, category === item.slug && styles.filterTextActive]}>{item.name}</Text></Pressable>)}
      </View>
      {products.length ? <View style={styles.products}>{products.map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View> : <View style={styles.empty}><Ionicons name="search-outline" size={38} color={colors.primary} /><Text style={styles.emptyTitle}>No encontramos productos</Text><Text style={styles.emptyText}>Prueba otra búsqueda o categoría.</Text></View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { paddingTop: 42, paddingBottom: spacing.lg }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 }, title: { marginTop: 6, color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1 }, subtitle: { marginTop: 8, color: colors.muted, fontSize: 15 },
  search: { maxWidth: 680, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, input: { flex: 1, color: colors.ink, fontSize: 15, outlineStyle: 'none' } as never,
  filters: { marginVertical: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, filter: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, backgroundColor: colors.surface }, filterActive: { borderColor: colors.primary, backgroundColor: colors.primary }, filterText: { color: colors.text, fontSize: 12, fontWeight: '700' }, filterTextActive: { color: colors.surface },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, empty: { alignItems: 'center', marginTop: spacing.xl, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surface }, emptyTitle: { marginTop: spacing.md, color: colors.ink, fontSize: 20, fontWeight: '900' }, emptyText: { marginTop: spacing.xs, color: colors.muted },
});
