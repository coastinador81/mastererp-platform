import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

const suggestions = ['Frutas y verduras', 'Proteínas', 'Despensa'];

export function ShoppingAssistant() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const search = (value = query) => {
    const normalized = value.trim();
    router.push({ pathname: '/catalog', params: normalized ? { q: normalized } : undefined });
  };
  return <View style={styles.root} accessibilityLabel="Asistente de compra">
    <View style={styles.userMessage}><Text style={styles.userCopy}>Necesito hacer un mercado para la semana para dos personas</Text><View style={styles.userAvatar}><Ionicons name="person" size={20} color={colors.primary} /></View></View>
    <View style={styles.assistantMessage}><View style={styles.assistantAvatar}><Ionicons name="sparkles" size={22} color={colors.primary} /></View><View style={styles.assistantBody}>
      <Text style={styles.assistantCopy}><Text style={styles.strong}>¡Claro!</Text> ¿Qué te gustaría incluir?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestions}>{suggestions.map(item => <Pressable key={item} style={styles.chip} onPress={() => search(item)}><Text style={styles.chipText}>{item}</Text></Pressable>)}</ScrollView>
    </View></View>
    <View style={styles.composer}><Pressable style={styles.add} onPress={() => router.push('/catalog')} accessibilityLabel="Ver categorías"><Ionicons name="add" size={22} color={colors.ink} /></Pressable>
      <View style={styles.field}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => search()} placeholder="Escribe qué necesitas..." placeholderTextColor={colors.muted} style={styles.input} returnKeyType="search" /><Ionicons name="mic-outline" size={20} color={colors.muted} /></View>
      <Pressable style={styles.send} onPress={() => search()} accessibilityLabel="Buscar"><Ionicons name="send" size={17} color={colors.surface} /></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { marginTop: spacing.md }, userMessage: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15, borderWidth: 1, borderColor: '#0d9b8a2e', borderRadius: radii.lg, backgroundColor: '#e2f6f2' },
  userCopy: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 }, userAvatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#c8efe8' },
  assistantMessage: { flexDirection: 'row', gap: 14, marginTop: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  assistantAvatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.primarySoft }, assistantBody: { flex: 1, minWidth: 0 }, assistantCopy: { marginBottom: 14, color: colors.ink, fontSize: 14 }, strong: { fontWeight: '900' },
  suggestions: { gap: 8 }, chip: { minHeight: 38, paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#0d9b8a33', borderRadius: radii.pill, backgroundColor: colors.primarySoft }, chipText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12, padding: 8, borderRadius: radii.lg, backgroundColor: colors.surface }, add: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.canvas }, field: { flex: 1, minWidth: 0, height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: '#fbfcfd' }, input: { flex: 1, color: colors.ink, outlineStyle: 'none' } as never, send: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.primary },
});
