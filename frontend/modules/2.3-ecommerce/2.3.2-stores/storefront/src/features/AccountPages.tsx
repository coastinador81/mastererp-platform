import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { loadPaymentMethods } from '../api';
import { signOut, startLogin } from '../auth';
import { Screen } from '../components/Screen';
import { storefrontScope } from '../config';
import { useStore } from '../store/StoreProvider';
import { colors, radii, spacing } from '../theme';
import type { CustomerPaymentMethod } from '../types';

type NoticePreferences = { orders: boolean; offers: boolean; account: boolean };
const noticeKey = () => `mastererp.storefront.notifications:${storefrontScope()}`;
const initialNotices = (): NoticePreferences => {
  if (typeof localStorage === 'undefined') return { orders: true, offers: false, account: true };
  try { return { orders: true, offers: false, account: true, ...JSON.parse(localStorage.getItem(noticeKey()) || '{}') }; }
  catch { return { orders: true, offers: false, account: true }; }
};

export function PaymentMethodsPage() {
  const { authenticated } = useStore();
  const [methods, setMethods] = useState<CustomerPaymentMethod[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    loadPaymentMethods()
      .then(items => { if (active) { setMethods(items); setStatus('ready'); } })
      .catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [authenticated]);
  return <Page title="Métodos de pago" subtitle="Tus datos de pago guardados en esta tienda">
    {!authenticated ? <><InfoCard icon="lock-closed-outline" title="Inicia sesión" body="Tus métodos de pago se guardan en tu cuenta." /><Pressable style={styles.primary} onPress={() => void startLogin()}><Text style={styles.primaryText}>Iniciar sesión</Text></Pressable></>
      : status === 'loading' ? <InfoCard icon="time-outline" title="Cargando métodos de pago…" body="Consultando tus datos guardados." />
      : status === 'error' ? <InfoCard icon="alert-circle-outline" title="No pudimos cargar tus métodos de pago" body="Inténtalo nuevamente en unos minutos." />
      : methods.length ? methods.map(item => <View key={item.method} style={styles.card}><View style={styles.icon}><Ionicons name={item.method === 'mobile' ? 'phone-portrait-outline' : 'business-outline'} size={22} color={colors.primaryDark} /></View><View style={styles.copy}><Text style={styles.cardTitle}>{item.method === 'mobile' ? 'Pago móvil' : 'Transferencia bancaria'}</Text><View style={styles.details}><Text style={styles.detail}>Banco: {item.bankCode}</Text><Text style={styles.detail}>Documento: {item.document}</Text>{item.phone ? <Text style={styles.detail}>Teléfono: {item.phone}</Text> : null}{item.holder ? <Text style={styles.detail}>Titular: {item.holder}</Text> : null}</View></View></View>)
      : <InfoCard icon="card-outline" title="Aún no tienes métodos guardados" body="Cuando pagues con Pago móvil o Transferencia, guardaremos tus datos para tu próxima compra." />}
    <Text style={styles.note}>Se actualizan cada vez que confirmas una compra con Pago móvil o Transferencia.</Text>
  </Page>;
}

export function NotificationsPage() {
  const [preferences, setPreferences] = useState(initialNotices);
  const change = (key: keyof NoticePreferences, value: boolean) => {
    const next = { ...preferences, [key]: value }; setPreferences(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(noticeKey(), JSON.stringify(next));
  };
  return <Page title="Notificaciones" subtitle="Controla los avisos de esta tienda">
    <Toggle label="Estado de mis compras" detail="Cambios importantes relacionados con tus pedidos." value={preferences.orders} onChange={value => change('orders', value)} />
    <Toggle label="Ofertas y novedades" detail="Promociones publicadas por la tienda." value={preferences.offers} onChange={value => change('offers', value)} />
    <Toggle label="Seguridad de la cuenta" detail="Avisos relacionados con tu acceso." value={preferences.account} onChange={value => change('account', value)} />
    <Text style={styles.note}>Estas preferencias se conservan en este dispositivo. El envío desde backend se habilitará cuando exista su contrato de notificaciones.</Text>
  </Page>;
}

export function SecurityPage() {
  const { authenticated } = useStore();
  return <Page title="Seguridad" subtitle="Acceso protegido por Cognito MasterERP">
    <InfoCard icon="shield-checkmark-outline" title={authenticated ? 'Sesión activa' : 'Sesión no iniciada'} body="Tu contraseña y los proveedores de acceso son administrados por Cognito; la tienda no almacena tu contraseña." />
    {authenticated ? <Pressable style={styles.dangerButton} onPress={signOut}><Ionicons name="log-out-outline" size={20} color={colors.danger} /><Text style={styles.dangerText}>Cerrar sesión en este dispositivo</Text></Pressable> : <Pressable style={styles.primary} onPress={() => void startLogin()}><Text style={styles.primaryText}>Iniciar sesión</Text></Pressable>}
  </Page>;
}

export function PrivacyPage() {
  return <Page title="Privacidad" subtitle="Información sobre tus datos en la tienda">
    <InfoCard icon="person-outline" title="Cuenta" body="Tu identidad se vincula por el emisor y el identificador de Cognito, no por coincidencia de correo." />
    <InfoCard icon="location-outline" title="Direcciones" body="Tus lugares de entrega pertenecen a tu cuenta dentro de esta tienda. Al usar el mapa, OpenStreetMap y Nominatim procesan la ubicación seleccionada." />
    <InfoCard icon="bag-handle-outline" title="Compras" body="Los pedidos conservan los datos necesarios para cobrar, preparar y entregar la compra." />
    <InfoCard icon="card-outline" title="Métodos de pago" body="Si pagas con Pago móvil o Transferencia, guardamos en tu cuenta de esta tienda el banco, la cédula o RIF, el teléfono y el titular que indicaste, para tu próxima compra. No guardamos claves ni números de tarjeta." />
    <Text style={styles.note}>Esta pantalla describe el comportamiento actual; no sustituye los términos legales que publique el responsable de la tienda.</Text>
  </Page>;
}

export function HelpPage() {
  return <Page title="Ayuda" subtitle="Respuestas rápidas">
    <InfoCard icon="cart-outline" title="¿Cómo completo una compra?" body="Agrega productos al carrito, elige una dirección y selecciona uno de los métodos habilitados por la tienda." />
    <InfoCard icon="receipt-outline" title="¿Dónde veo mi pedido?" body="En Mi cuenta → Mis compras puedes consultar el estado, pago, entrega y detalle de cada pedido." />
    <InfoCard icon="location-outline" title="¿Cómo cambio la dirección?" body="Abre Mis datos y direcciones, selecciona una dirección guardada y ajusta el punto en el mapa." />
    <Text style={styles.note}>Los canales de contacto específicos se mostrarán cuando la tienda los configure en el backend.</Text>
  </Page>;
}

function Page({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const router = useRouter();
  return <Screen><View style={styles.page}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={19} color={colors.ink} /><Text style={styles.backText}>Mi cuenta</Text></Pressable><Text style={styles.eyebrow}>MI CUENTA</Text><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>{children}</View></Screen>;
}
function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.card}><View style={styles.copy}><Text style={styles.cardTitle}>{label}</Text><Text style={styles.body}>{detail}</Text></View><Switch value={value} onValueChange={onChange} trackColor={{ false: colors.line, true: colors.primary }} /></View>; }
function InfoCard({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) { return <View style={styles.card}><View style={styles.icon}><Ionicons name={icon} size={22} color={colors.primaryDark} /></View><View style={styles.copy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.body}>{body}</Text></View></View>; }
const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingTop: 28, paddingBottom: 40, gap: spacing.md }, back: { alignSelf: 'flex-start', minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7 }, backText: { color: colors.ink, fontWeight: '800' }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 }, title: { color: colors.ink, fontSize: 32, fontWeight: '900' }, subtitle: { marginTop: -8, color: colors.muted, fontSize: 13 },
  card: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primarySoft }, copy: { flex: 1 }, cardTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' }, body: { marginTop: 4, color: colors.muted, fontSize: 11, lineHeight: 17 }, details: { gap: 3, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.primarySoft }, detail: { color: colors.text, fontSize: 11 }, note: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.primary }, primaryText: { color: colors.surface, fontWeight: '900' }, dangerButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, dangerText: { color: colors.danger, fontWeight: '900' },
});
