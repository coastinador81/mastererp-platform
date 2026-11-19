import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { assistantConfigured, sendAssistantMessage } from '../api';
import { colors, spacing } from '../theme';
import { useStore } from '../store/StoreProvider';

export function ShoppingAssistant() {
  const router = useRouter();
  const { catalog, selectedNode } = useStore();
  const [query, setQuery] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const search = (value = query) => {
    const normalized = value.trim();
    router.push({ pathname: '/catalog', params: normalized ? { q: normalized } : undefined });
  };
  const send = async (value = query) => {
    const normalized = value.trim();
    if (!normalized || sending) return;
    if (!assistantConfigured) return search(normalized);
    setSending(true); setError(''); setReply('');
    try {
      const result = await sendAssistantMessage(normalized, conversationId, selectedNode || undefined);
      setConversationId(result.conversation_id);
      setReply(result.message);
      setQuery('');
    } catch {
      setError('El asistente no está disponible en este momento. Puedes buscar directamente en el catálogo.');
    } finally { setSending(false); }
  };
  return <View style={styles.root} accessibilityLabel="Asistente de compra">
    <View style={styles.heading}><View style={styles.icon}><Ionicons name="sparkles" size={20} color="#8ee2b4" /></View><View style={styles.headingCopy}><Text style={styles.eyebrow}>ASISTENTE CON IA</Text><Text style={styles.title}>¿Qué necesitas resolver hoy?</Text></View></View>
    <Text style={styles.description}>Cuéntame qué quieres cocinar, tu presupuesto o para cuántas personas compras.</Text>
    <View style={styles.composer}>
      <TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void send()} editable={!sending} placeholder="Ej. “Cena saludable para 4”" placeholderTextColor="#7a847e" style={styles.input} returnKeyType="send" />
      <Pressable disabled={!query.trim() || sending} style={[styles.send, (!query.trim() || sending) && styles.sendDisabled]} onPress={() => void send()} accessibilityLabel={assistantConfigured ? 'Enviar al asistente' : 'Buscar en el catálogo'}><Ionicons name={sending ? 'hourglass-outline' : 'send'} size={17} color={colors.surface} /></Pressable>
    </View>
    {reply ? <View style={styles.reply}><Ionicons name="sparkles" size={15} color="#8ee2b4" /><Text style={styles.replyText}>{reply}</Text></View> : null}
    {error ? <View style={styles.reply}><Text style={styles.errorText}>{error}</Text><Pressable onPress={() => search(query)}><Text style={styles.searchLink}>Buscar</Text></Pressable></View> : null}
    {!assistantConfigured ? <Text style={styles.pending}>La búsqueda inteligente se habilitará cuando el servicio esté configurado.</Text> : null}
    <View style={styles.suggestions}>{catalog?.categories.slice(0, 2).map(category => <Pressable key={category.slug} style={styles.suggestion} onPress={() => void send(category.name)}><Ionicons name="basket-outline" size={15} color="#d9e6df" /><Text style={styles.suggestionText}>{category.name}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { marginTop: spacing.md, padding: 20, borderRadius: 24, backgroundColor: '#0d2b1e', shadowColor: '#083920', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, icon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#64e09a21' }, headingCopy: { flex: 1 }, eyebrow: { color: '#8ee2b4', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }, title: { marginTop: 2, color: colors.surface, fontSize: 20, lineHeight: 24, fontWeight: '800' },
  description: { marginTop: 13, color: '#b8c9bf', fontSize: 12, lineHeight: 19 }, composer: { height: 48, marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 7, borderRadius: 14, backgroundColor: colors.surface }, input: { flex: 1, color: '#17201b', fontSize: 12, outlineStyle: 'none' } as never, send: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.primary }, sendDisabled: { opacity: .45 }, reply: { marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 13, backgroundColor: '#ffffff10' }, replyText: { flex: 1, color: '#e6f2eb', fontSize: 11, lineHeight: 17 }, errorText: { flex: 1, color: '#f4c7c7', fontSize: 10, lineHeight: 16 }, searchLink: { color: '#8ee2b4', fontSize: 10, fontWeight: '900' }, pending: { marginTop: 9, color: '#8fa198', fontSize: 9, lineHeight: 14 }, suggestions: { marginTop: 10, flexDirection: 'row', gap: 8 }, suggestion: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#345143', borderRadius: 999 }, suggestionText: { color: '#d9e6df', fontSize: 10 },
});
