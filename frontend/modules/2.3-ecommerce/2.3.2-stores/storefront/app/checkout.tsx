import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { PaymentMethods } from '@/components/PaymentMethods';
import { loadAddresses, submitCheckout } from '@/api';
import { startLogin } from '@/auth';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';
import type { CustomerAddress, PaymentMethod } from '@/types';

const money = (value: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(value);

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, catalog, authenticated, clearCart } = useStore();
  const [address, setAddress] = useState('');
  const [savedAddress, setSavedAddress] = useState<CustomerAddress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const subtotal = cart.reduce((total, line) => total + line.product.price * line.quantity, 0);

  useEffect(() => {
    if (authenticated) loadAddresses().then(items => {
      const selected = items.find(item => item.default) || items[0];
      if (selected) { setSavedAddress(selected); setAddress([selected.address, selected.unit, selected.zone].filter(Boolean).join(', ')); }
    }).catch(() => undefined);
  }, [authenticated]);

  const confirm = async () => {
    if (!authenticated) return startLogin();
    if (!address.trim()) return setError('Indica la dirección de entrega.');
    if (paymentMethod !== 'cash' && !/^\d{4,40}$/.test(paymentReference.trim())) return setError('Indica una referencia de pago válida.');
    setSubmitting(true); setError('');
    try {
      const order = await submitCheckout(cart, savedAddress || address.trim(), paymentMethod, paymentReference.trim());
      clearCart(); setOrderNumber(order.number);
    } catch (reason) {
      const status = typeof reason === 'object' && reason && 'status' in reason ? Number(reason.status) : 0;
      setError(status === 409 ? 'No hay inventario suficiente para completar el pedido.' : 'No se pudo crear el pedido. Intenta nuevamente.');
    } finally { setSubmitting(false); }
  };

  if (orderNumber) return <Screen><View style={styles.success}><View style={styles.successIcon}><Ionicons name="checkmark" size={44} color={colors.surface} /></View><Text style={styles.successTitle}>¡Tu pedido fue creado!</Text><Text style={styles.successText}>Pedido <Text style={styles.order}>{orderNumber}</Text>. Ya está registrado en MasterERP.</Text><Pressable style={styles.primary} onPress={() => router.replace('/')}><Text style={styles.primaryText}>Volver al inicio</Text></Pressable></View></Screen>;
  if (!cart.length) return <Screen><View style={styles.success}><Text style={styles.successTitle}>Tu carrito está vacío</Text><Pressable style={styles.primary} onPress={() => router.replace('/catalog')}><Text style={styles.primaryText}>Ver catálogo</Text></Pressable></View></Screen>;

  return (
    <Screen>
      <View style={styles.heading}><Text style={styles.eyebrow}>ÚLTIMO PASO</Text><Text style={styles.title}>Confirma tu pedido</Text><Text style={styles.subtitle}>MasterERP validará nuevamente precios, tienda e inventario.</Text></View>
      <View style={styles.layout}>
        <View style={styles.form}>
          <View style={styles.sectionTitle}><View style={styles.step}><Text style={styles.stepText}>1</Text></View><View><Text style={styles.sectionHeading}>Entrega</Text><Text style={styles.sectionHint}>Indica dónde quieres recibir tu compra.</Text></View></View>
          <Text style={styles.label}>Dirección de entrega</Text>
          <TextInput value={address} onChangeText={value => { setSavedAddress(null); setAddress(value); }} placeholder="Calle, edificio, apartamento y referencia" placeholderTextColor={colors.muted} multiline maxLength={500} style={styles.address} />
          <View style={styles.sectionTitle}><View style={styles.step}><Text style={styles.stepText}>2</Text></View><View><Text style={styles.sectionHeading}>Pago</Text><Text style={styles.sectionHint}>Opciones configuradas por esta tienda.</Text></View></View>
          <PaymentMethods configuration={catalog?.store.configuration} method={paymentMethod} reference={paymentReference} onMethod={value => { setPaymentMethod(value); setPaymentReference(''); }} onReference={setPaymentReference} />
          {!authenticated ? <View style={styles.notice}><Ionicons name="person-outline" size={21} color={colors.primaryDark} /><Text style={styles.noticeText}>Para proteger tu pedido, inicia sesión con tu cuenta MasterERP antes de confirmar.</Text></View> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <View style={styles.summary}><Text style={styles.summaryTitle}>Tu pedido</Text>{cart.map(line => <View key={line.product.id} style={styles.row}><Text style={styles.item}>{line.quantity} × {line.product.name}</Text><Text style={styles.itemPrice}>{money(line.product.price * line.quantity)}</Text></View>)}<View style={styles.divider} /><View style={styles.row}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.total}>{money(subtotal)}</Text></View><Text style={styles.delivery}>El costo final de entrega será determinado por las reglas de la tienda.</Text><Pressable disabled={submitting} style={[styles.primary, submitting && styles.disabled]} onPress={() => void confirm()}><Text style={styles.primaryText}>{authenticated ? (submitting ? 'Creando pedido…' : 'Confirmar pedido') : 'Acceder para continuar'}</Text><Ionicons name={authenticated ? 'checkmark-circle-outline' : 'log-in-outline'} size={20} color={colors.surface} /></Pressable></View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { paddingTop: 42, paddingBottom: spacing.lg }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, title: { marginTop: 5, color: colors.ink, fontSize: 34, fontWeight: '900' }, subtitle: { marginTop: 7, color: colors.muted }, layout: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.lg },
  form: { flex: 2, minWidth: 300, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, sectionTitle: { marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, step: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primarySoft }, stepText: { color: colors.primaryDark, fontWeight: '900' }, sectionHeading: { color: colors.ink, fontSize: 18, fontWeight: '900' }, sectionHint: { marginTop: 2, color: colors.muted, fontSize: 11 }, label: { marginBottom: spacing.sm, color: colors.text, fontSize: 12, fontWeight: '800' }, address: { minHeight: 110, marginBottom: spacing.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, color: colors.ink, backgroundColor: colors.canvas, textAlignVertical: 'top', outlineStyle: 'none' } as never,
  notice: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft }, noticeText: { flex: 1, color: colors.primaryDark, fontSize: 12, lineHeight: 18 }, error: { marginTop: spacing.md, color: colors.danger, fontWeight: '800' },
  summary: { flex: 1, minWidth: 290, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, summaryTitle: { marginBottom: spacing.lg, color: colors.ink, fontSize: 20, fontWeight: '900' }, row: { marginBottom: spacing.md, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, item: { flex: 1, color: colors.text, fontSize: 12 }, itemPrice: { color: colors.ink, fontSize: 12, fontWeight: '800' }, divider: { height: 1, marginVertical: spacing.sm, backgroundColor: colors.line }, totalLabel: { color: colors.ink, fontSize: 17, fontWeight: '900' }, total: { color: colors.ink, fontSize: 19, fontWeight: '900' }, delivery: { color: colors.muted, fontSize: 10, lineHeight: 16 }, primary: { minHeight: 55, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radii.md, backgroundColor: colors.primary }, primaryText: { color: colors.surface, fontWeight: '900' }, disabled: { opacity: 0.5 },
  success: { alignItems: 'center', marginTop: 60, padding: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface }, successIcon: { width: 82, height: 82, alignItems: 'center', justifyContent: 'center', borderRadius: 41, backgroundColor: colors.success }, successTitle: { marginTop: spacing.lg, color: colors.ink, fontSize: 28, fontWeight: '900', textAlign: 'center' }, successText: { marginTop: spacing.sm, color: colors.muted, textAlign: 'center' }, order: { color: colors.primary, fontWeight: '900' },
});
