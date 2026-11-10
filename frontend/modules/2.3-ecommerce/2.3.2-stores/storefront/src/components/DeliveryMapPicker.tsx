import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

type Props = {
  latitude: string;
  longitude: string;
  onChange: (latitude: string, longitude: string) => void;
  onAddressChange: (address: string) => void;
};

export function DeliveryMapPicker({ latitude, longitude }: Props) {
  return <View style={styles.notice}>
    <Text style={styles.title}>Punto de entrega</Text>
    <Text style={styles.text}>{latitude && longitude ? `${latitude}, ${longitude}` : 'Selecciona la ubicación desde la versión web.'}</Text>
  </View>;
}

const styles = StyleSheet.create({
  notice: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.canvas },
  title: { color: colors.ink, fontWeight: '800' },
  text: { color: colors.muted, fontSize: 12 },
});
