import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadAddresses, saveAddress, updateAddress } from '../api';
import { colors, radii, spacing } from '../theme';
import type { CustomerAddress } from '../types';
import { DeliveryMapPicker } from './DeliveryMapPicker';

type Draft = Omit<CustomerAddress, 'id' | 'version'>;
const EMPTY: Draft = { label: 'Casa', address: '', zone: '', unit: '', reference: '', latitude: 0, longitude: 0, default: false };
const PRESETS = ['Casa', 'Trabajo'];
const saveError = (reason: unknown) => {
  const { status, code } = (reason || {}) as { status?: number; code?: string };
  if (status === 401 || code === 'session_expired') return 'Tu sesión expiró. Vuelve a iniciar sesión para guardar la dirección.';
  if (status === 404) return 'Tu cuenta aún no está vinculada a esta tienda. Cierra sesión e ingresa nuevamente.';
  if (status === 409) return 'Esta dirección cambió en otra sesión. Recarga la página e inténtalo nuevamente.';
  if (status === 403) return 'No tienes permiso para guardar direcciones en esta tienda.';
  if (status === 400) return 'Revisa los datos: la dirección debe tener al menos 5 caracteres y la zona al menos 2.';
  return 'No pudimos guardar la dirección. Inténtalo nuevamente en unos minutos.';
};

export function AddressManager({ onBack }: { onBack: () => void }) {
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<CustomerAddress | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [menu, setMenu] = useState('');
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

  const open = (item: CustomerAddress | null) => {
    setMenu(''); setMessage(''); setEditing(item); setFormOpen(true);
    setDraft(item ? { label: item.label, address: item.address, zone: item.zone, unit: item.unit || '', reference: item.reference || '', latitude: item.latitude, longitude: item.longitude, default: item.default } : EMPTY);
    setLatitude(item ? String(item.latitude) : '');
    setLongitude(item ? String(item.longitude) : '');
  };
  const close = () => { setFormOpen(false); setEditing(null); setDraft(EMPTY); setLatitude(''); setLongitude(''); };
  const save = async () => {
    const lat = Number(latitude), lng = Number(longitude);
    if (draft.address.trim().length < 5) return setMessage('Ingresa la dirección de entrega completa.');
    if (draft.zone.trim().length < 2) return setMessage('Ingresa la zona de entrega.');
    if (!latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) return setMessage('Selecciona el punto de entrega en el mapa.');
    if (!draft.label.trim()) return setMessage('Escribe un nombre para esta dirección.');
    setSaving(true); setMessage('');
    const payload = { ...draft, label: draft.label.trim(), address: draft.address.trim(), zone: draft.zone.trim(), latitude: lat, longitude: lng, default: editing?.default || addresses.length === 0 };
    try {
      if (editing) await updateAddress({ ...payload, id: editing.id, version: editing.version });
      else await saveAddress(payload);
      close(); await reload(); setMessage(editing ? 'Dirección actualizada.' : 'Dirección guardada.');
    } catch (reason) { setMessage(saveError(reason)); }
    finally { setSaving(false); }
  };
  const makeDefault = async (item: CustomerAddress) => {
    setMenu(''); setMessage('');
    try { await updateAddress({ ...item, default: true }); await reload(); setMessage('Dirección de entrega actualizada.'); }
    catch (reason) { setMessage(saveError(reason)); }
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  if (formOpen) {
    const custom = !PRESETS.includes(draft.label);
    return <View style={styles.section}>
      <Header title={editing ? 'Editar dirección' : 'Nueva dirección'} onBack={close} />
      <Text style={styles.sectionTitle}>Detalles de la dirección</Text>
      <Field label="Dirección" value={draft.address} onChangeText={value => set('address', value)} placeholder="Calle, avenida, urbanización…" />
      <Field label="Zona de entrega" value={draft.zone} onChangeText={value => set('zone', value)} placeholder="Ej. Paz Castillo, Miranda" />
      <Field label="Número de piso / Apartamento / Casa" value={draft.unit || ''} onChangeText={value => set('unit', value)} placeholder="Ej. Piso 2, apartamento 2-B" />
      <Text style={styles.sectionTitle}>Punto de entrega</Text>
      <DeliveryMapPicker latitude={latitude} longitude={longitude} onChange={(lat, lng) => { setLatitude(lat); setLongitude(lng); }} onAddressChange={value => set('address', value)} />
      <Text style={styles.sectionTitle}>Indicaciones para la entrega</Text>
      <Field label="Referencias / Indicaciones para la entrega" value={draft.reference || ''} onChangeText={value => set('reference', value.slice(0, 100))} placeholder="Ej. Casa blanca con rejas" multiline />
      <View style={styles.helperRow}><Text style={styles.help}>Ej: casa blanca con rejas al lado de la tienda.</Text><Text style={styles.help}>{(draft.reference || '').length}/100</Text></View>
      <Text style={styles.sectionTitle}>¿Qué nombre le damos a esta dirección?</Text>
      <View style={styles.chips}>{[...PRESETS, 'Otro'].map(option => {
        const active = option === 'Otro' ? custom : draft.label === option;
        return <Pressable key={option} style={[styles.chip, active && styles.chipActive]} onPress={() => set('label', option === 'Otro' ? (custom ? draft.label : '') : option)} accessibilityRole="button" accessibilityState={{ selected: active }}>
          <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>{option === 'Otro' && active ? <Ionicons name="pencil" size={13} color={colors.surface} /> : null}
        </Pressable>;
      })}</View>
      {custom ? <Field label="Otro" value={draft.label} onChangeText={value => set('label', value.slice(0, 60))} placeholder="Ej: Casa de Luis" /> : null}
      {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
      <Pressable style={[styles.primary, saving && styles.disabled]} onPress={() => void save()} disabled={saving}><Text style={styles.primaryText}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar dirección'}</Text></Pressable>
    </View>;
  }

  const main = addresses.find(item => item.default), others = addresses.filter(item => item !== main);
  const row = (item: CustomerAddress) => <View key={item.id}>
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={`Editar ${item.label}`}>
        <Ionicons name="location-outline" size={22} color={colors.ink} />
        <View style={styles.copy}>
          {!item.default ? <Text style={styles.rowLabel}>{item.label}</Text> : null}
          <Text style={styles.rowTitle}>{[item.address, item.unit].filter(Boolean).join(', ')}</Text>
          <Text style={styles.help}>{item.reference || item.zone}</Text>
        </View>
      </Pressable>
      <Pressable style={styles.more} onPress={() => setMenu(current => current === item.id ? '' : item.id)} accessibilityRole="button" accessibilityLabel="Opciones de la dirección" accessibilityState={{ expanded: menu === item.id }}>
        <Ionicons name="ellipsis-vertical" size={18} color={colors.ink} />
      </Pressable>
    </View>
    {menu === item.id ? <View style={styles.menu}>
      <Pressable style={styles.menuItem} onPress={() => open(item)}><Ionicons name="create-outline" size={18} color={colors.ink} /><Text style={styles.menuText}>Editar</Text></Pressable>
      {!item.default ? <Pressable style={styles.menuItem} onPress={() => void makeDefault(item)}><Ionicons name="checkmark-circle-outline" size={18} color={colors.ink} /><Text style={styles.menuText}>Usar como dirección de entrega</Text></Pressable> : null}
    </View> : null}
  </View>;

  return <View style={styles.section}>
    <Header title="Mis direcciones" onBack={onBack} />
    {loading ? <Text style={styles.help}>Cargando direcciones…</Text> : !addresses.length ? <View style={styles.empty}><Ionicons name="location-outline" size={34} color={colors.muted} /><Text style={styles.rowTitle}>Aún no tienes direcciones</Text><Text style={styles.help}>Agrega una para seleccionarla durante la compra.</Text></View> : <>
      {main ? <><Text style={styles.sectionTitle}>Dirección de entrega</Text>{row(main)}</> : null}
      {others.length ? <><Text style={[styles.sectionTitle, styles.spaced]}>Otras direcciones</Text>{others.map(row)}</> : null}
    </>}
    {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
    <Pressable style={styles.primary} onPress={() => open(null)}><Text style={styles.primaryText}>Agregar dirección</Text></Pressable>
  </View>;
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.header}>
    <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Volver"><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable>
    <Text style={styles.headerTitle}>{title}</Text>
  </View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, multiline, ...inputProps } = props;
  return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...inputProps} multiline={multiline} placeholderTextColor={colors.muted} style={[styles.input, multiline && styles.multiline]} /></View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  header: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 56 }, backButton: { position: 'absolute', left: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }, headerTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  sectionTitle: { marginTop: spacing.sm, color: colors.ink, fontSize: 18, fontWeight: '900' }, spaced: { marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, rowMain: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 6 }, copy: { flex: 1, gap: 2 },
  rowLabel: { color: colors.muted, fontSize: 11, fontWeight: '800' }, rowTitle: { color: colors.ink, fontSize: 15, lineHeight: 21 }, help: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  more: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  menu: { marginLeft: 38, marginBottom: spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, menuItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md }, menuText: { color: colors.ink, fontSize: 14 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: spacing.xl },
  fieldLabel: { marginBottom: 6, color: colors.text, fontSize: 12, fontWeight: '700' }, input: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.ink }, multiline: { minHeight: 88, textAlignVertical: 'top' },
  helperRow: { marginTop: -8, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, chip: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas }, chipActive: { backgroundColor: colors.ink }, chipText: { color: colors.ink, fontWeight: '700' }, chipTextActive: { color: colors.surface },
  primary: { marginTop: spacing.md, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: colors.primary }, primaryText: { color: colors.surface, fontWeight: '900' }, disabled: { opacity: 0.6 }, message: { color: colors.primaryDark, fontWeight: '800', textAlign: 'center' },
});
