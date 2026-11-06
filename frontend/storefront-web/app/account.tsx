import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { startLogin, startRegistration, startLogin as login, signOut } from '@/auth';
import { useStore } from '@/store/StoreProvider';
import { colors, radii, spacing } from '@/theme';

export default function AccountPage() {
  const router = useRouter();
  const { authenticated } = useStore();
  return <Screen><View style={styles.card}><Text style={styles.title}>Mi cuenta</Text>
    {!authenticated ? <><Text style={styles.copy}>Accede para gestionar tus datos, direcciones y pedidos de esta tienda.</Text>
      <Pressable style={styles.primary} onPress={() => void startLogin()}><Text style={styles.primaryText}>Iniciar sesión</Text></Pressable>
      <Pressable style={styles.google} onPress={() => void login('Google')}><Text style={styles.googleText}>Continuar con Google</Text></Pressable>
      <Pressable onPress={() => void startRegistration()}><Text style={styles.link}>Crear cuenta o confirmar registro</Text></Pressable></>
    : <><Pressable style={styles.option} onPress={() => router.push('/profile')}><Text style={styles.optionText}>Perfil y direcciones</Text></Pressable>
      <Pressable style={styles.option} onPress={() => router.push('/orders')}><Text style={styles.optionText}>Mis pedidos</Text></Pressable>
      <Pressable onPress={signOut}><Text style={styles.danger}>Cerrar sesión</Text></Pressable></>}
  </View></Screen>;
}
const styles = StyleSheet.create({ card:{maxWidth:560,width:'100%',alignSelf:'center',marginTop:48,padding:spacing.xl,borderWidth:1,borderColor:colors.line,borderRadius:radii.lg,backgroundColor:colors.surface},title:{fontSize:30,fontWeight:'900',color:colors.ink},copy:{marginVertical:spacing.lg,color:colors.muted,lineHeight:22},primary:{padding:16,borderRadius:radii.md,backgroundColor:colors.primary,alignItems:'center'},primaryText:{color:colors.surface,fontWeight:'900'},google:{marginTop:spacing.sm,padding:15,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,alignItems:'center'},googleText:{color:colors.ink,fontWeight:'800'},link:{marginTop:spacing.lg,color:colors.primaryDark,fontWeight:'800',textAlign:'center'},option:{marginTop:spacing.md,padding:18,borderRadius:radii.md,backgroundColor:colors.primarySoft},optionText:{color:colors.primaryDark,fontWeight:'900'},danger:{marginTop:spacing.xl,color:colors.danger,fontWeight:'800',textAlign:'center'}});
