import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { signOut, startLogin } from '../auth';
import { useStore } from '../store/StoreProvider';
import { colors, radii, spacing } from '../theme';

const links = [
  ['Inicio', 'home-outline', '/'],
  ['Categorías', 'grid-outline', '/catalog'],
  ['Ofertas', 'pricetag-outline', '/offers'],
  ['Mis compras', 'bag-handle-outline', '/orders'],
  ['Mi cuenta', 'person-outline', '/account'],
  ['Mi carrito', 'cart-outline', '/cart'],
] as const;

export function HeaderMenu() {
  const router = useRouter();
  const { authenticated } = useStore();
  const [open, setOpen] = useState(false);
  const navigate = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  return <>
    <Pressable style={styles.trigger} onPress={() => setOpen(true)} accessibilityLabel="Abrir menú">
      <Ionicons name="menu" size={24} color={colors.ink} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.heading}>
            <Text style={styles.title}>Menú</Text>
            <Pressable style={styles.close} onPress={() => setOpen(false)} accessibilityLabel="Cerrar menú">
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.links}>{links.map(([label, icon, path]) =>
            <Pressable key={path} style={styles.link} onPress={() => navigate(path)}>
              <View style={styles.linkIcon}><Ionicons name={icon} size={20} color={colors.primaryDark} /></View>
              <Text style={styles.linkText}>{label}</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.muted} />
            </Pressable>)}</View>
          <Pressable style={styles.session} onPress={() => {
            setOpen(false);
            if (authenticated) signOut();
            else void startLogin();
          }}>
            <Ionicons name={authenticated ? 'log-out-outline' : 'log-in-outline'} size={20} color={authenticated ? colors.danger : colors.primaryDark} />
            <Text style={[styles.sessionText, authenticated && styles.danger]}>{authenticated ? 'Cerrar sesión' : 'Iniciar sesión'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0b1f3373' },
  sheet: { width: '100%', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface },
  handle: { width: 42, height: 4, alignSelf: 'center', marginBottom: spacing.md, borderRadius: 2, backgroundColor: colors.line },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  links: { gap: 8 },
  link: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface },
  linkIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.primarySoft },
  linkText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '800' },
  session: { minHeight: 48, marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sessionText: { color: colors.primaryDark, fontWeight: '800' },
  danger: { color: colors.danger },
});
