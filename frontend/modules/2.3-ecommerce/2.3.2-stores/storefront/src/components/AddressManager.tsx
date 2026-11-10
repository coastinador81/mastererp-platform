import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadAddresses, saveAddress, updateAddress } from '../api';
import { colors, radii, spacing } from '../theme';
import type { CustomerAddress } from '../types';
import { DeliveryMapPicker } from './DeliveryMapPicker';

type Draft = Omit<CustomerAddress, 'id' | 'version'>;
const EMPTY: Draft = { label: 'Casa', address: '', zone: '', unit: '', reference: '', latitude: 0, longitude: 0, default: false };
const saveError = (reason: unknown) => {
  const { status, code } = (reason || {}) as { status?: number; code?: string };
  if (status === 401 || code === 'session_expired') return 'Tu sesión expiró. Vuelve a iniciar sesión para guardar la dirección.';
  if (status === 404) return 'Tu cuenta aún no está vinculada a esta tienda. Cierra sesión e ingresa nuevamente.';
  if (status === 409) return 'Esta dirección cambió en otra sesión. Recarga la página e inténtalo nuevamente.';
  if (status === 403) return 'No tienes permiso para guardar direcciones en esta tienda.';
  if (status === 400) return 'Revisa los datos: la dirección debe tener al menos 5 caracteres y la zona al menos 2.';
  return 'No pudimos guardar la dirección. Inténtalo nuevamente en unos minutos.';
};

export function AddressManager() {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const reload = async () => {
    try { setAddresses(await loadAddresses()); }
    catch { setMessage('No pudimos cargar tus direcciones.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    let active = true;
    void loadAddresses()
      .then(items => { if (active) setAddresses(items); })
      .catch(() => { if (active) setMessage('No pudimos cargar tus direcciones.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const select = (item: CustomerAddress) => {
    setEditing(item);
    setDraft({ label: item.label, address: item.address, zone: item.zone, unit: item.unit || '', reference: item.reference || '', latitude: item.latitude, longitude: item.longitude, default: item.default });
    setLatitude(String(item.latitude));
    setLongitude(String(item.longitude));
    setMessage('Editando esta dirección.');
  };
  const reset = () => {
    setEditing(null); setDraft(EMPTY); setLatitude(''); setLongitude(''); setMessage('');
  };
  const save = async () => {
    const lat = Number(latitude), lng = Number(longitude);
    if (draft.address.trim().length < 5) return setMessage('Ingresa la dirección de entrega completa.');
    if (draft.zone.trim().length < 2) return setMessage('Ingresa la zona de entrega.');
    if (!latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) return setMessage('Selecciona el punto de entrega en el mapa.');
    setSaving(true); setMessage('');
    const payload = { ...draft, address: draft.address.trim(), zone: draft.zone.trim(), latitude: lat, longitude: lng, default: editing?.default || addresses.length === 0 };
    try {
      if (editing) await updateAddress({ ...payload, id: editing.id, version: editing.version });
      else await saveAddress(payload);
      reset(); await reload(); setMessage(editing ? 'Dirección actualizada.' : 'Dirección guardada.');
    } catch (reason) { setMessage(saveError(reason)); }
    finally { setSaving(false); }
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  return <View style={styles.section}>
    <View style={styles.heading}><View><Text style={styles.title}>Mis direcciones</Text><Text style={styles.help}>Guarda tus lugares de entrega y selecciónalos durante la compra.</Text></View></View>
    {loading ? <Text style={styles.help}>Cargando direcciones…</Text> : addresses.map(item => <Pressable key={item.id} style={[styles.addressCard, editing?.id === item.id && styles.selected]} onPress={() => select(item)} accessibilityRole="button">
      <View style={styles.icon}><Ionicons name="location" size={20} color={colors.primaryDark} /></View>
      <View style={styles.copy}><Text style={styles.addressTitle}>{item.label}{item.default ? ' · Principal' : ''}</Text><Text style={styles.help}>{[item.address, item.unit, item.zone].filter(Boolean).join(', ')}</Text>{item.reference ? <Text style={styles.reference}>{item.reference}</Text> : null}</View>
      <Ionicons name="create-outline" size={19} color={colors.muted} />
    </Pressable>)}
    <View style={styles.form}>
      <View style={styles.formHeading}><Text style={styles.title}>{editing ? 'Editar dirección' : 'Agregar dirección'}</Text>{editing ? <Pressable onPress={reset}><Text style={styles.cancel}>Cancelar</Text></Pressable> : null}</View>
      <Text style={styles.fieldLabel}>¿Qué nombre le damos?</Text>
      <View style={styles.labels}>{['Casa', 'Trabajo', 'Otro'].map(option => <Pressable key={option} style={[styles.label, draft.label === option && styles.labelSelected]} onPress={() => set('label', option)}><Text style={[styles.labelText, draft.label === option && styles.labelTextSelected]}>{option}</Text></Pressable>)}</View>
      <Field label="Dirección completa" value={draft.address} onChangeText={value => set('address', value)} placeholder="Calle, avenida, urbanización…" />
      <Field label="Zona de entrega" value={draft.zone} onChangeText={value => set('zone', value)} placeholder="Ej. Paz Castillo, Miranda" />
      <Field label="Piso, apartamento o casa" value={draft.unit || ''} onChangeText={value => set('unit', value)} placeholder="Ej. Piso 2, apartamento 2-B" />
      <Text style={styles.title}>Punto de entrega</Text>
      <DeliveryMapPicker latitude={latitude} longitude={longitude} onChange={(lat, lng) => { setLatitude(lat); setLongitude(lng); }} onAddressChange={value => set('address', value)} />
      <Field label="Indicaciones para la entrega" value={draft.reference || ''} onChangeText={value => set('reference', value.slice(0, 100))} placeholder="Ej. Casa blanca con rejas" multiline />
      <Text style={styles.counter}>{(draft.reference || '').length}/100</Text>
      <Pressable style={[styles.primary, saving && styles.disabled]} onPress={() => void save()} disabled={saving}><Text style={styles.primaryText}>{saving ? 'Guardando…' : editing ? 'Actualizar dirección' : 'Guardar dirección'}</Text></Pressable>
    </View>
    {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
  </View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, multiline, ...inputProps } = props;
  return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} multiline={multiline} placeholderTextColor={colors.muted} style={[styles.input, multiline && styles.multiline]} /></View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.md }, heading: { flexDirection: 'row', justifyContent: 'space-between' }, title: { color: colors.ink, fontSize: 18, fontWeight: '900' }, help: { marginTop: 3, color: colors.muted, fontSize: 11, lineHeight: 17 },
  addressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primarySoft }, copy: { flex: 1 }, addressTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' }, reference: { marginTop: 4, color: colors.text, fontSize: 10 },
  form: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface }, formHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cancel: { color: colors.danger, fontWeight: '800' }, fieldLabel: { marginBottom: 6, color: colors.text, fontSize: 12, fontWeight: '800' }, input: { minHeight: 50, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.canvas, color: colors.ink }, multiline: { minHeight: 88, textAlignVertical: 'top' },
  labels: { flexDirection: 'row', gap: spacing.sm }, label: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas }, labelSelected: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft }, labelText: { color: colors.text, fontWeight: '700' }, labelTextSelected: { color: colors.primaryDark }, counter: { marginTop: -10, color: colors.muted, fontSize: 10, textAlign: 'right' },
  primary: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.primary }, primaryText: { color: colors.surface, fontWeight: '900' }, disabled: { opacity: 0.6 }, message: { color: colors.primaryDark, fontWeight: '800', textAlign: 'center' },
});
