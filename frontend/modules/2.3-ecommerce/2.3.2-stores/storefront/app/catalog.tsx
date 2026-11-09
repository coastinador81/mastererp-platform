import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';
import { useLayoutWidth } from '@/useLayoutWidth';

type Sort = 'relevance' | 'priceAsc' | 'priceDesc' | 'name';
const sortOptions: [Sort, string][] = [['relevance', 'Relevancia'], ['priceAsc', 'Menor precio'], ['priceDesc', 'Mayor precio'], ['name', 'Nombre A-Z']];
const effectivePrice = (product: { price: number; offer_price?: number }) => product.offer_price != null && product.offer_price < product.price ? product.offer_price : product.price;

export default function CatalogPage() {
  const params = useLocalSearchParams<{ category?: string; q?: string; offers?: string }>();
  const width = useLayoutWidth();
  const { catalog } = useStore();
  const [category, setCategory] = useState(params.category || '');
  const [query, setQuery] = useState(params.q || '');
  const [sort, setSort] = useState<Sort>('relevance');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const products = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('es');
    const filtered = (catalog?.products || []).filter(product => {
      const matchesCategory = !category || product.category_ref === category;
      const matchesQuery = !term || `${product.name} ${product.description || ''} ${product.brand_ref || ''}`.toLocaleLowerCase('es').includes(term);
      const matchesOffers = params.offers !== '1' || effectivePrice(product) < product.price;
      return matchesCategory && matchesQuery && matchesOffers && (!availableOnly || product.available > 0);
    });
    if (sort === 'priceAsc') return filtered.sort((left, right) => effectivePrice(left) - effectivePrice(right));
    if (sort === 'priceDesc') return filtered.sort((left, right) => effectivePrice(right) - effectivePrice(left));
    if (sort === 'name') return filtered.sort((left, right) => left.name.localeCompare(right.name, 'es'));
    return filtered;
  }, [availableOnly, catalog?.products, category, params.offers, query, sort]);
  const cardWidth = width < 520 ? '47%' : '31%';
  const activeFilterCount = Number(availableOnly) + Number(sort !== 'relevance');

  return <Screen>
    <View style={styles.intro}><Text style={styles.eyebrow}>CATÁLOGO</Text><Text style={styles.title}>Encuentra lo que necesitas</Text><Text style={styles.subtitle}>Disponibilidad y precios de esta tienda.</Text></View>
    <View style={styles.searchRow}><View style={styles.search}><Ionicons name="search" size={20} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Buscar productos o marcas" placeholderTextColor={colors.muted} style={styles.input} /></View><Pressable style={[styles.filterButton, filtersOpen && styles.filterButtonActive]} onPress={() => setFiltersOpen(open => !open)} accessibilityLabel="Abrir filtros"><Ionicons name="options-outline" size={21} color={filtersOpen ? colors.surface : colors.ink} />{activeFilterCount ? <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View> : null}</Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <FilterChip label="Todos" active={!category} onPress={() => setCategory('')} />
      {catalog?.categories.map(item => <FilterChip key={item.slug} label={item.name} active={category === item.slug} onPress={() => setCategory(item.slug)} />)}
    </ScrollView>
    {filtersOpen ? <View style={styles.filterPanel}><Text style={styles.filterTitle}>Ordenar por</Text><View style={styles.sortOptions}>{sortOptions.map(([value, label]) => <FilterChip key={value} label={label} active={sort === value} onPress={() => setSort(value)} />)}</View><Pressable style={styles.available} onPress={() => setAvailableOnly(value => !value)}><Ionicons name={availableOnly ? 'checkbox' : 'square-outline'} size={22} color={colors.primaryDark} /><Text style={styles.availableText}>Solo productos disponibles</Text></Pressable></View> : null}
    <View style={styles.results}><Text style={styles.resultCount}>{products.length} {products.length === 1 ? 'producto' : 'productos'}</Text>{activeFilterCount ? <Pressable onPress={() => { setSort('relevance'); setAvailableOnly(false); }}><Text style={styles.clear}>Limpiar filtros</Text></Pressable> : null}</View>
    {products.length ? <View style={styles.products}>{products.map(product => <ProductCard key={product.id} product={product} width={cardWidth} />)}</View> : <View style={styles.empty}><Ionicons name="search-outline" size={38} color={colors.primary} /><Text style={styles.emptyTitle}>No encontramos productos</Text><Text style={styles.emptyText}>Prueba otra búsqueda o categoría.</Text></View>}
  </Screen>;
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  intro: { paddingTop: 34, paddingBottom: spacing.lg }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.1 }, title: { marginTop: 6, color: colors.ink, fontSize: 32, fontWeight: '900', letterSpacing: -1 }, subtitle: { marginTop: 8, color: colors.muted, fontSize: 14 },
  searchRow: { flexDirection: 'row', gap: spacing.sm }, search: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, input: { flex: 1, color: colors.ink, fontSize: 15, outlineStyle: 'none' } as never,
  filterButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, filterButtonActive: { borderColor: colors.primary, backgroundColor: colors.primary }, filterBadge: { position: 'absolute', top: -5, right: -5, minWidth: 19, height: 19, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.offer }, filterBadgeText: { color: colors.surface, fontSize: 9, fontWeight: '900' },
  chips: { gap: 8, paddingVertical: spacing.md, paddingRight: spacing.md }, chip: { paddingHorizontal: 15, paddingVertical: 9, borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, backgroundColor: colors.surface }, chipActive: { borderColor: colors.primary, backgroundColor: colors.primary }, chipText: { color: colors.text, fontSize: 12, fontWeight: '700' }, chipTextActive: { color: colors.surface },
  filterPanel: { gap: spacing.md, marginBottom: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, filterTitle: { color: colors.ink, fontWeight: '900' }, sortOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, available: { flexDirection: 'row', alignItems: 'center', gap: 9 }, availableText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  results: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, resultCount: { color: colors.muted, fontSize: 12 }, clear: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }, empty: { alignItems: 'center', marginTop: spacing.xl, padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surface }, emptyTitle: { marginTop: spacing.md, color: colors.ink, fontSize: 20, fontWeight: '900' }, emptyText: { marginTop: spacing.xs, color: colors.muted },
});
