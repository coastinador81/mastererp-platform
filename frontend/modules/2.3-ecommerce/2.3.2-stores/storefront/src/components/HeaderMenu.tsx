import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { startLogin } from '../auth';
import { useStore } from '../store/StoreProvider';
import { colors } from '../theme';

const links = [
  ['Inicio', 'home-outline', '/'],
  ['Explorar', 'search-outline', '/catalog'],
  ['Ofertas', 'pricetag-outline', '/offers'],
  ['Ayuda', 'help-circle-outline', '/help'],
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
          <View style={styles.grid}>{links.map(([label, icon, path]) =>
            <Pressable key={path} style={styles.link} onPress={() => navigate(path)}>
              <Ionicons name={icon} size={21} color={colors.primaryDark} />
              <Text style={styles.linkText}>{label}</Text>
            </Pressable>)}</View>
          <Pressable style={styles.account} onPress={() => {
            setOpen(false);
            if (authenticated) router.push('/account');
            else void startLogin();
          }}>
            <View style={styles.accountIcon}><Ionicons name="person-outline" size={21} color={colors.primaryDark} /></View>
            <View style={styles.accountCopy}><Text style={styles.accountTitle}>{authenticated ? 'Ver mi cuenta' : 'Iniciar sesión'}</Text><Text style={styles.accountText}>{authenticated ? 'Datos, pedidos y preferencias' : 'Guarda direcciones y consulta pedidos'}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  trigger: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#08160e75' },
  sheet: { width: '100%', maxHeight: '82%', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 26, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.surface, shadowColor: '#081c11', shadowOpacity: .18, shadowRadius: 24, shadowOffset: { width: 0, height: -12 } },
  handle: { width: 38, height: 4, alignSelf: 'center', marginTop: 2, marginBottom: 14, borderRadius: 2, backgroundColor: '#dce2de' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  title: { color: '#17201b', fontSize: 21, fontWeight: '800', letterSpacing: -.6 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#f2f5f3' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  link: { width: '48.5%', minHeight: 86, alignItems: 'flex-start', justifyContent: 'space-between', padding: 14, borderRadius: 17, backgroundColor: '#f3f7f4' },
  linkText: { color: '#243029', fontSize: 11, fontWeight: '800' },
  account: { minHeight: 68, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: '#e4e9e5', borderRadius: 17 },
  accountIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.primarySoft },
  accountCopy: { flex: 1 }, accountTitle: { color: colors.ink, fontSize: 11, fontWeight: '800' }, accountText: { marginTop: 3, color: '#758079', fontSize: 9 },
});
