import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import type { PaymentMethod, StoreConfiguration } from '../types';

type Props = {
  configuration?: StoreConfiguration;
  method?: PaymentMethod;
  onMethod: (method: PaymentMethod) => void;
};

type Option = { id: PaymentMethod; title: string; hint: string; icon: keyof typeof Ionicons.glyphMap };
const BUILT_IN: Option[] = [
  { id: 'mobile', title: 'Pago móvil', hint: 'Paga con los datos de esta tienda.', icon: 'phone-portrait-outline' },
  { id: 'cash', title: 'Pago al recibir', hint: 'Paga en efectivo durante la entrega.', icon: 'cash-outline' },
  { id: 'pos', title: 'Punto de venta', hint: 'Paga con tarjeta al entregar tu pedido.', icon: 'card-outline' },
  { id: 'transfer', title: 'Transferencia bancaria', hint: 'Transfiere a la cuenta de esta tienda.', icon: 'business-outline' },
];

const customMethods = (configuration?: StoreConfiguration) => (configuration?.paymentDetails?.customMethods || []).filter(item => item.enabled && item.name?.trim() && item.instructions?.trim());
const customFor = (method: PaymentMethod, configuration?: StoreConfiguration) => method.startsWith('custom:') ? customMethods(configuration).find(item => `custom:${item.id}` === method) : undefined;

export function paymentLabel(method: PaymentMethod, configuration?: StoreConfiguration) {
  return customFor(method, configuration)?.name || BUILT_IN.find(option => option.id === method)?.title || 'Otro método';
}

function recipientFor(method: PaymentMethod, configuration?: StoreConfiguration) {
  if (method === 'mobile') return configuration?.paymentDetails?.mobilePayment;
  if (method === 'transfer') return configuration?.paymentDetails?.bankTransfer;
  return null;
}

function configured(method: PaymentMethod, configuration?: StoreConfiguration) {
  const flags = configuration?.payments;
  if (method === 'cash') return flags?.efectivo !== false && flags?.['al-recibir'] !== false;
  if (method === 'pos') return flags?.['punto-venta-entrega'] === true;
  if (method === 'mobile') return flags?.['pago-movil'] === true && Boolean(recipientFor(method, configuration));
  if (method === 'transfer') return flags?.transferencia === true && Boolean(recipientFor(method, configuration));
  return Boolean(customFor(method, configuration));
}

export function PaymentMethods({ configuration, method, onMethod }: Props) {
  const options = [...BUILT_IN, ...customMethods(configuration).map((item): Option => ({ id: `custom:${item.id}`, title: item.name.trim(), hint: 'Paga y luego indica la referencia.', icon: 'wallet-outline' }))];
  return <View style={styles.wrap}>
    {options.map(option => {
      const enabled = configured(option.id, configuration);
      const selected = method === option.id;
      return <Pressable key={option.id} disabled={!enabled} onPress={() => onMethod(option.id)} style={[styles.option, selected && styles.selected, !enabled && styles.disabled]}>
        <View style={[styles.icon, selected && styles.iconSelected]}><Ionicons name={option.icon} size={22} color={selected ? colors.primaryDark : colors.muted} /></View>
        <View style={styles.copy}><Text style={styles.title}>{option.title}</Text><Text style={styles.hint}>{enabled ? option.hint : 'No configurado por esta tienda.'}</Text></View>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.muted} />
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 }, option: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: '#e4e9e5', borderRadius: 16, backgroundColor: colors.surface }, selected: { borderColor: colors.primary, backgroundColor: '#f2f7f1' }, disabled: { opacity: 0.48 }, icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#f3f5f3' }, iconSelected: { backgroundColor: '#e1efdf' }, copy: { flex: 1 }, title: { color: colors.ink, fontSize: 13, fontWeight: '900' }, hint: { marginTop: 3, color: colors.muted, fontSize: 10 },
});
