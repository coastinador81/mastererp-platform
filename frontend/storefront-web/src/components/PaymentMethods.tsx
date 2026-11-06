import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '../theme';
import type { PaymentMethod, PaymentRecipient, StoreConfiguration } from '../types';

type Props = {
  configuration?: StoreConfiguration;
  method: PaymentMethod;
  reference: string;
  onMethod: (method: PaymentMethod) => void;
  onReference: (value: string) => void;
};

const options: { id: PaymentMethod; title: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'mobile', title: 'Pago móvil', hint: 'Paga con los datos de esta tienda.', icon: 'phone-portrait-outline' },
  { id: 'cash', title: 'Pago al recibir', hint: 'Coordina el pago durante la entrega.', icon: 'cash-outline' },
  { id: 'transfer', title: 'Transferencia bancaria', hint: 'Transfiere a la cuenta de esta tienda.', icon: 'business-outline' },
];

function recipientFor(method: PaymentMethod, configuration?: StoreConfiguration) {
  if (method === 'mobile') return configuration?.paymentDetails?.mobilePayment;
  if (method === 'transfer') return configuration?.paymentDetails?.bankTransfer;
  return null;
}

function configured(method: PaymentMethod, configuration?: StoreConfiguration) {
  const flags = configuration?.payments;
  if (method === 'cash') return flags?.efectivo !== false && flags?.['al-recibir'] !== false;
  if (method === 'mobile') return flags?.['pago-movil'] === true && Boolean(recipientFor(method, configuration));
  return flags?.transferencia === true && Boolean(recipientFor(method, configuration));
}

export function PaymentMethods({ configuration, method, reference, onMethod, onReference }: Props) {
  const recipient = recipientFor(method, configuration);
  return <View style={styles.wrap}>
    {options.map(option => {
      const enabled = configured(option.id, configuration);
      const selected = method === option.id;
      return <Pressable key={option.id} disabled={!enabled} onPress={() => onMethod(option.id)} style={[styles.option, selected && styles.selected, !enabled && styles.disabled]}>
        <Ionicons name={option.icon} size={25} color={selected ? colors.primary : colors.muted} />
        <View style={styles.copy}><Text style={styles.title}>{option.title}</Text><Text style={styles.hint}>{enabled ? option.hint : 'No configurado por esta tienda.'}</Text></View>
        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.muted} />
      </Pressable>;
    })}
    {method !== 'cash' && recipient ? <PaymentDetails method={method} recipient={recipient} reference={reference} onReference={onReference} /> : null}
  </View>;
}

function PaymentDetails({ method, recipient, reference, onReference }: { method: PaymentMethod; recipient: PaymentRecipient; reference: string; onReference: (value: string) => void }) {
  return <View style={styles.details}>
    <Text style={styles.detailsTitle}>{method === 'mobile' ? 'Datos para pago móvil' : 'Datos para transferencia'}</Text>
    <Text style={styles.data}>Documento: {recipient.document}</Text>
    {recipient.phone ? <Text style={styles.data}>Teléfono: {recipient.phone}</Text> : null}
    <Text style={styles.data}>Banco: {recipient.bankCode}{recipient.bankName ? ` · ${recipient.bankName}` : ''}</Text>
    {recipient.accountNumber ? <Text style={styles.data}>Cuenta: {recipient.accountNumber}</Text> : null}
    {recipient.accountHolder ? <Text style={styles.data}>Titular: {recipient.accountHolder}</Text> : null}
    <Text style={styles.referenceLabel}>Número de referencia</Text>
    <TextInput value={reference} onChangeText={onReference} inputMode="numeric" maxLength={40} placeholder="Ej. 12345678" placeholderTextColor={colors.muted} style={styles.input} />
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm }, option: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface }, selected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft }, disabled: { opacity: 0.48 }, copy: { flex: 1 }, title: { color: colors.ink, fontWeight: '900' }, hint: { marginTop: 3, color: colors.muted, fontSize: 11 }, details: { gap: 7, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft }, detailsTitle: { marginBottom: 3, color: colors.ink, fontSize: 15, fontWeight: '900' }, data: { color: colors.text, fontSize: 12 }, referenceLabel: { marginTop: 8, color: colors.ink, fontSize: 12, fontWeight: '800' }, input: { minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, color: colors.ink, backgroundColor: colors.surface, outlineStyle: 'none' } as never,
});
