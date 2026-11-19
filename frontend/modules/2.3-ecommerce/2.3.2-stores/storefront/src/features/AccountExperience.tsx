import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadProfile, saveProfile } from '../api';
import { sessionEmail, signOut, startLogin, startRegistration } from '../auth';
import { AppLoading } from '../components/AppLoading';
import { AddressManager } from '../components/AddressManager';
import { Screen } from '../components/Screen';
import { useStore } from '../store/StoreProvider';
import { colors, radii, spacing } from '../theme';
import type { CustomerProfile } from '../types';

type Icon = keyof typeof Ionicons.glyphMap;
const SHORTCUTS: { label: string; icon: Icon; route: string }[] = [
  { label: 'Información personal', icon: 'person-outline', route: '/profile' },
  { label: 'Mis compras', icon: 'receipt-outline', route: '/orders' },
  { label: 'Ayuda', icon: 'headset-outline', route: '/help' },
];
const SECTIONS: { title: string; items: { label: string; detail: string; icon: Icon; route: string }[] }[] = [
  { title: 'Perfil', items: [{ label: 'Direcciones', detail: 'Lugares de entrega', icon: 'location-outline', route: '/addresses' }, { label: 'Métodos de pago', detail: 'Opciones guardadas', icon: 'card-outline', route: '/payment-methods' }] },
  { title: 'Actividad', items: [{ label: 'Mi carrito', detail: 'Productos seleccionados', icon: 'cart-outline', route: '/cart' }] },
  { title: 'Configuración', items: [{ label: 'Notificaciones', detail: 'Pedidos, ofertas y seguridad', icon: 'notifications-outline', route: '/notifications' }, { label: 'Seguridad', detail: 'Acceso y contraseña', icon: 'lock-closed-outline', route: '/security' }, { label: 'Privacidad', detail: 'Uso de tus datos', icon: 'information-circle-outline', route: '/privacy' }] },
];

export function AccountExperience() {
  const router = useRouter(), { authenticated, sessionLoading } = useStore();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  useEffect(() => { if (authenticated) loadProfile().then(setProfile).catch(() => undefined); }, [authenticated]);
  if (sessionLoading) return <Screen><AppLoading title="Preparando tu cuenta…" detail="Recuperando tu sesión." /></Screen>;
  const firstName = profile?.name?.trim().split(/\s+/)[0];
  const email = sessionEmail();
  return <Screen><View style={styles.page}>
    {!authenticated ? <><View><Text style={styles.title}>Mi cuenta</Text><Text style={styles.accountSubtitle}>Inicia sesión para administrar tus datos y pedidos.</Text></View><View style={styles.login}><View style={styles.loginAvatar}><Ionicons name="person-outline" size={28} color={colors.surface} /></View><Text style={styles.loginEyebrow}>TU CUENTA</Text><Text style={styles.loginTitle}>Compra más rápido</Text><Text style={styles.loginBody}>Guarda direcciones, consulta pedidos y completa tus compras con seguridad.</Text><Pressable style={styles.loginButton} onPress={() => void startLogin()}><Text style={styles.whiteText}>Iniciar sesión</Text><Ionicons name="arrow-forward" size={18} color={colors.surface} /></Pressable><Pressable style={styles.google} onPress={() => void startLogin('Google')}><Ionicons name="logo-google" size={18} color={colors.ink} /><Text style={styles.googleText}>Continuar con Google</Text></Pressable><Pressable style={styles.registerButton} onPress={() => void startRegistration()}><Text style={styles.register}>Crear una cuenta</Text></Pressable></View><View style={styles.publicLinks}><Pressable onPress={() => router.push('/help')}><Text style={styles.publicLink}>Ayuda</Text></Pressable><View style={styles.publicDivider}/><Pressable onPress={() => router.push('/privacy')}><Text style={styles.publicLink}>Privacidad</Text></Pressable></View></> : <>
      <View><Text style={styles.title}>Mi cuenta</Text><Text style={styles.accountSubtitle}>{firstName ? `¡Hola, ${firstName}! Administra tus datos y preferencias.` : 'Administra tus datos y preferencias.'}</Text></View>
      <Pressable style={styles.profileSummary} onPress={() => router.push('/profile')} accessibilityLabel="Información personal"><View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(profile?.name || email || '?').slice(0, 1).toUpperCase()}</Text></View><View style={styles.profileCopy}><Text style={styles.profileName} numberOfLines={1}>{profile?.name || 'Información personal'}</Text>{email ? <Text style={styles.profileEmail} numberOfLines={1}>{email}</Text> : null}</View><View style={styles.profileAction}><Ionicons name="chevron-forward" size={18} color={colors.primaryDark} /></View></Pressable>
      <View style={styles.shortcuts}>{SHORTCUTS.map(item => <Pressable key={item.route} style={styles.shortcut} onPress={() => router.push(item.route)}><View style={styles.shortcutIcon}><Ionicons name={item.icon} size={22} color={colors.ink} /></View><Text style={styles.shortcutLabel}>{item.label}</Text></Pressable>)}</View>
      {SECTIONS.map(section => <View key={section.title} style={styles.section}><Text style={styles.sectionLabel}>{section.title}</Text><View style={styles.rowGroup}>{section.items.map(item => <Row key={item.route} label={item.label} detail={item.detail} icon={item.icon} onPress={() => router.push(item.route)} />)}</View></View>)}
      <Pressable style={styles.logout} onPress={signOut}><Ionicons name="log-out-outline" size={18} color={colors.muted} /><Text style={styles.logoutText}>Cerrar sesión</Text></Pressable>
    </>}
  </View></Screen>;
}

export function ProfileExperience() {
  const { authenticated, sessionLoading } = useStore();
  const [name,setName]=useState(''),[phone,setPhone]=useState('+58'),[birthDate,setBirthDate]=useState(''),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
  useEffect(()=>{if(authenticated)loadProfile().then(profile=>{setName(profile.name);setPhone(profile.phone||'+58');setBirthDate(profile.birthDate||'');}).catch(()=>setMessage('No pudimos cargar tu perfil.')).finally(()=>setLoading(false));},[authenticated]);
  const update=async()=>{try{await saveProfile({name,phone:phone.replace(/[\s()-]/g,''),birthDate,photoUrl:''});setMessage('Perfil actualizado.');}catch{setMessage('Revisa teléfono (+58) y fecha AAAA-MM-DD.');}};
  if(sessionLoading||authenticated&&loading)return <Screen><AppLoading title="Cargando tu perfil…" detail="Consultando tus datos." /></Screen>;
  if(!authenticated)return <SignedOut title="Información personal"/>;
  const email=sessionEmail();
  return <Screen><View style={styles.page}><Back/><Text style={styles.title}>Información personal</Text>
    <View style={styles.formCard}><Field label="Nombre completo" value={name} onChange={setName}/><Field label="Teléfono" value={phone} onChange={setPhone} placeholder="+584121234567"/><Field label="Fecha de nacimiento" value={birthDate} onChange={setBirthDate} placeholder="AAAA-MM-DD"/>{email?<View><Text style={styles.fieldLabel}>Correo</Text><Text style={styles.readOnly}>{email}</Text><Text style={styles.optionDetail}>Es el correo con el que inicias sesión.</Text></View>:null}<Pressable style={styles.primary} onPress={()=>void update()}><Text style={styles.whiteText}>Guardar mis datos</Text></Pressable></View>
    {message?<Text style={styles.message}>{message}</Text>:null}
  </View></Screen>;
}

export function AddressesExperience() {
  const router = useRouter(), { authenticated, sessionLoading } = useStore();
  if(sessionLoading)return <Screen><AppLoading title="Cargando tus direcciones…" detail="Recuperando tu sesión." /></Screen>;
  if(!authenticated)return <SignedOut title="Direcciones"/>;
  return <Screen><View style={styles.page}><AddressManager onBack={()=>router.back()} /></View></Screen>;
}

function Back(){const router=useRouter();return <Pressable style={styles.back} onPress={()=>router.back()}><Ionicons name="arrow-back" size={19} color={colors.ink}/><Text style={styles.backText}>Mi cuenta</Text></Pressable>;}
function SignedOut({title}:{title:string}){return <Screen><View style={styles.page}><Back/><Text style={styles.title}>{title}</Text><Text style={styles.message}>Inicia sesión para consultar los datos de esta tienda.</Text><Pressable style={styles.primary} onPress={()=>void startLogin()}><Text style={styles.whiteText}>Iniciar sesión</Text></Pressable></View></Screen>;}

function Row({ label, detail, icon, onPress }: { label: string; detail: string; icon: Icon; onPress: () => void }) {
  return <Pressable style={styles.row} onPress={onPress} accessibilityRole="button"><View style={styles.rowIcon}><Ionicons name={icon} size={19} color={colors.primaryDark} /></View><View style={styles.rowCopy}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowDetail}>{detail}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable>;
}

function Field({label,value,onChange,placeholder}: {label:string;value:string;onChange:(value:string)=>void;placeholder?:string}) { return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input}/></View>; }

const styles=StyleSheet.create({page:{width:'100%',maxWidth:720,alignSelf:'center',paddingTop:28,paddingBottom:40,gap:spacing.md},eyebrow:{color:colors.primary,fontSize:11,fontWeight:'900',letterSpacing:1.2},title:{color:'#17201b',fontSize:31,lineHeight:34,fontWeight:'900',letterSpacing:-1},accountSubtitle:{marginTop:8,color:'#717b75',fontSize:13,lineHeight:20},login:{marginTop:8,padding:24,borderRadius:24,backgroundColor:'#0d2b1e',shadowColor:'#083920',shadowOpacity:.14,shadowRadius:18,shadowOffset:{width:0,height:10}},loginAvatar:{width:52,height:52,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:'#ffffff16'},loginEyebrow:{marginTop:20,color:'#b8c9bf',fontSize:9,fontWeight:'900',letterSpacing:1.2},loginTitle:{marginTop:5,color:colors.surface,fontSize:22,fontWeight:'900'},loginBody:{marginTop:9,color:'#b8c9bf',fontSize:12,lineHeight:20},loginButton:{minHeight:48,marginTop:22,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,paddingHorizontal:18,borderRadius:14,backgroundColor:colors.primary},whiteText:{color:colors.surface,fontWeight:'900'},google:{minHeight:48,marginTop:spacing.sm,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:14,backgroundColor:colors.surface},googleText:{color:colors.ink,fontWeight:'800'},registerButton:{minHeight:44,alignItems:'center',justifyContent:'center'},register:{color:'#b8c9bf',fontSize:12,fontWeight:'800',textAlign:'center'},publicLinks:{minHeight:46,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:18},publicLink:{color:colors.primaryDark,fontSize:12,fontWeight:'800'},publicDivider:{width:1,height:14,backgroundColor:colors.line},profileSummary:{minHeight:80,flexDirection:'row',alignItems:'center',gap:12,padding:14,borderRadius:18,backgroundColor:'#f1f6f2'},profileAvatar:{width:50,height:50,alignItems:'center',justifyContent:'center',borderRadius:15,backgroundColor:colors.primary},profileAvatarText:{color:colors.surface,fontSize:17,fontWeight:'900'},profileCopy:{flex:1,minWidth:0},profileName:{color:colors.ink,fontSize:14,fontWeight:'900'},profileEmail:{marginTop:4,color:colors.muted,fontSize:10},profileAction:{width:36,height:36,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.surface},shortcuts:{marginTop:4,flexDirection:'row',justifyContent:'space-between',gap:spacing.sm},shortcut:{flex:1,maxWidth:110,alignItems:'center',gap:8},shortcutIcon:{width:76,height:60,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:colors.canvas},shortcutLabel:{color:colors.ink,fontSize:11,lineHeight:15,textAlign:'center'},section:{marginTop:10},sectionLabel:{marginBottom:7,color:colors.ink,fontSize:16,fontWeight:'900'},rowGroup:{overflow:'hidden',borderWidth:1,borderColor:'#e6ebe7',borderRadius:18,backgroundColor:colors.surface},row:{minHeight:70,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:'#edf0ee'},rowIcon:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#f0f5f1'},rowCopy:{flex:1},rowLabel:{color:colors.ink,fontSize:13,fontWeight:'800'},rowDetail:{marginTop:3,color:colors.muted,fontSize:9},logout:{minHeight:48,marginTop:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:colors.line,borderRadius:14},logoutText:{color:colors.muted,fontSize:12,fontWeight:'800'},back:{alignSelf:'flex-start',minHeight:42,flexDirection:'row',alignItems:'center',gap:7},backText:{color:colors.ink,fontWeight:'800'},readOnly:{minHeight:50,paddingHorizontal:14,paddingVertical:15,borderRadius:radii.md,backgroundColor:colors.canvas,color:colors.muted},optionDetail:{marginTop:3,color:colors.muted,fontSize:11,lineHeight:16},formCard:{gap:spacing.md,padding:spacing.lg,borderWidth:1,borderColor:colors.line,borderRadius:radii.lg,backgroundColor:colors.surface},sectionHeading:{flexDirection:'row',alignItems:'center',gap:12},sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},fieldLabel:{marginBottom:6,color:colors.text,fontSize:12,fontWeight:'800'},input:{minHeight:50,paddingHorizontal:14,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.canvas,color:colors.ink},primary:{minHeight:52,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.lg,borderRadius:radii.md,backgroundColor:colors.primary},addressCard:{flexDirection:'row',alignItems:'flex-start',gap:12,padding:spacing.md,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.surface},addressIcon:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.primarySoft},reference:{marginTop:4,color:colors.text,fontSize:10},coordinates:{flexDirection:'row',gap:spacing.sm},flex:{flex:1},message:{color:colors.primaryDark,fontWeight:'800',textAlign:'center'}});
