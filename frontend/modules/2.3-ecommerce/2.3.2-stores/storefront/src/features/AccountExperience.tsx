import { Ionicons } from '@expo/vector-icons';
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
const SECTIONS: { title: string; items: { label: string; icon: Icon; route: string }[] }[] = [
  { title: 'Perfil', items: [{ label: 'Direcciones', icon: 'location-outline', route: '/addresses' }, { label: 'Métodos de pago', icon: 'card-outline', route: '/payment-methods' }] },
  { title: 'Actividad', items: [{ label: 'Mi carrito', icon: 'cart-outline', route: '/cart' }] },
  { title: 'Configuración', items: [{ label: 'Notificaciones', icon: 'notifications-outline', route: '/notifications' }, { label: 'Seguridad', icon: 'lock-closed-outline', route: '/security' }, { label: 'Privacidad', icon: 'information-circle-outline', route: '/privacy' }] },
];

export function AccountExperience() {
  const router = useRouter(), { authenticated, sessionLoading } = useStore();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  useEffect(() => { if (authenticated) loadProfile().then(setProfile).catch(() => undefined); }, [authenticated]);
  if (sessionLoading) return <Screen><AppLoading title="Preparando tu cuenta…" detail="Recuperando tu sesión." /></Screen>;
  const firstName = profile?.name?.trim().split(/\s+/)[0];
  return <Screen><View style={styles.page}>
    {!authenticated ? <><Text style={styles.title}>Mi cuenta</Text><View style={styles.login}><View style={styles.loginAvatar}><Ionicons name="person-outline" size={30} color="#b9f2e8" /></View><Text style={styles.loginTitle}>Compra más rápido</Text><Text style={styles.loginBody}>Inicia sesión para guardar direcciones, ver tus compras y completar pedidos con seguridad.</Text><Pressable style={styles.loginButton} onPress={() => void startLogin()}><Text style={styles.whiteText}>Iniciar sesión</Text><Ionicons name="arrow-forward" size={18} color={colors.surface} /></Pressable><Pressable style={styles.google} onPress={() => void startLogin('Google')}><Ionicons name="logo-google" size={18} color={colors.ink} /><Text style={styles.googleText}>Continuar con Google</Text></Pressable><Pressable onPress={() => void startRegistration()}><Text style={styles.register}>Crear una cuenta</Text></Pressable></View></> : <>
      <View style={styles.hello}><Text style={styles.helloText} numberOfLines={1}>{firstName ? `¡Hola, ${firstName}!` : '¡Hola!'}</Text><Pressable style={styles.avatar} onPress={() => router.push('/profile')} accessibilityLabel="Información personal"><Text style={styles.avatarLetter}>{(profile?.name || '?').slice(0, 1).toUpperCase()}</Text></Pressable></View>
      <View style={styles.shortcuts}>{SHORTCUTS.map(item => <Pressable key={item.route} style={styles.shortcut} onPress={() => router.push(item.route)}><View style={styles.shortcutIcon}><Ionicons name={item.icon} size={22} color={colors.ink} /></View><Text style={styles.shortcutLabel}>{item.label}</Text></Pressable>)}</View>
      {SECTIONS.map(section => <View key={section.title} style={styles.section}><Text style={styles.sectionLabel}>{section.title}</Text>{section.items.map(item => <Row key={item.route} label={item.label} icon={item.icon} onPress={() => router.push(item.route)} />)}</View>)}
      <View style={styles.section}><Row label="Cerrar sesión" icon="log-out-outline" onPress={signOut} /></View>
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
  const { authenticated, sessionLoading } = useStore();
  if(sessionLoading)return <Screen><AppLoading title="Cargando tus direcciones…" detail="Recuperando tu sesión." /></Screen>;
  if(!authenticated)return <SignedOut title="Direcciones"/>;
  return <Screen><View style={styles.page}><Back/><AddressManager /></View></Screen>;
}

function Back(){const router=useRouter();return <Pressable style={styles.back} onPress={()=>router.back()}><Ionicons name="arrow-back" size={19} color={colors.ink}/><Text style={styles.backText}>Mi cuenta</Text></Pressable>;}
function SignedOut({title}:{title:string}){return <Screen><View style={styles.page}><Back/><Text style={styles.title}>{title}</Text><Text style={styles.message}>Inicia sesión para consultar los datos de esta tienda.</Text><Pressable style={styles.primary} onPress={()=>void startLogin()}><Text style={styles.whiteText}>Iniciar sesión</Text></Pressable></View></Screen>;}

function Row({ label, icon, onPress }: { label: string; icon: Icon; onPress: () => void }) {
  return <Pressable style={styles.row} onPress={onPress} accessibilityRole="button"><Ionicons name={icon} size={22} color={colors.ink} /><Text style={styles.rowLabel}>{label}</Text><Ionicons name="chevron-forward" size={18} color={colors.ink} /></Pressable>;
}

function Field({label,value,onChange,placeholder}: {label:string;value:string;onChange:(value:string)=>void;placeholder?:string}) { return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input}/></View>; }

const styles=StyleSheet.create({page:{width:'100%',maxWidth:720,alignSelf:'center',paddingTop:34,paddingBottom:40,gap:spacing.md},eyebrow:{color:colors.primary,fontSize:11,fontWeight:'900',letterSpacing:1.2},title:{color:colors.ink,fontSize:32,fontWeight:'900'},login:{padding:spacing.xl,borderRadius:radii.lg,backgroundColor:colors.navy},loginAvatar:{width:56,height:56,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:'#0d9b8a33'},loginTitle:{marginTop:spacing.lg,color:colors.surface,fontSize:23,fontWeight:'900'},loginBody:{marginTop:9,color:'#c0cfdb',fontSize:13,lineHeight:21},loginButton:{alignSelf:'flex-start',minHeight:48,marginTop:spacing.lg,flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:18,borderRadius:radii.md,backgroundColor:colors.primary},whiteText:{color:colors.surface,fontWeight:'900'},google:{minHeight:48,marginTop:spacing.sm,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:'#ffffff55',borderRadius:radii.md,backgroundColor:colors.surface},googleText:{color:colors.ink,fontWeight:'800'},register:{marginTop:spacing.md,color:'#b9f2e8',fontWeight:'800',textAlign:'center'},hello:{minHeight:56,flexDirection:'row',alignItems:'center',justifyContent:'center',paddingHorizontal:56},helloText:{color:colors.ink,fontSize:18,fontWeight:'900',textAlign:'center'},avatar:{position:'absolute',right:0,width:46,height:46,alignItems:'center',justifyContent:'center',borderRadius:23,backgroundColor:colors.primarySoft},avatarLetter:{color:colors.primaryDark,fontSize:19,fontWeight:'900'},shortcuts:{marginTop:spacing.md,flexDirection:'row',justifyContent:'space-between',gap:spacing.sm},shortcut:{flex:1,maxWidth:110,alignItems:'center',gap:8},shortcutIcon:{width:76,height:64,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:colors.canvas},shortcutLabel:{color:colors.ink,fontSize:12,lineHeight:16,textAlign:'center'},section:{marginTop:spacing.md},sectionLabel:{marginBottom:4,color:colors.ink,fontSize:17,fontWeight:'900'},row:{minHeight:52,flexDirection:'row',alignItems:'center',gap:spacing.md},rowLabel:{flex:1,color:colors.ink,fontSize:15},back:{alignSelf:'flex-start',minHeight:42,flexDirection:'row',alignItems:'center',gap:7},backText:{color:colors.ink,fontWeight:'800'},readOnly:{minHeight:50,paddingHorizontal:14,paddingVertical:15,borderRadius:radii.md,backgroundColor:colors.canvas,color:colors.muted},optionDetail:{marginTop:3,color:colors.muted,fontSize:11,lineHeight:16},formCard:{gap:spacing.md,padding:spacing.lg,borderWidth:1,borderColor:colors.line,borderRadius:radii.lg,backgroundColor:colors.surface},sectionHeading:{flexDirection:'row',alignItems:'center',gap:12},sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},fieldLabel:{marginBottom:6,color:colors.text,fontSize:12,fontWeight:'800'},input:{minHeight:50,paddingHorizontal:14,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.canvas,color:colors.ink},primary:{minHeight:52,alignItems:'center',justifyContent:'center',paddingHorizontal:spacing.lg,borderRadius:radii.md,backgroundColor:colors.primary},addressCard:{flexDirection:'row',alignItems:'flex-start',gap:12,padding:spacing.md,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.surface},addressIcon:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:colors.primarySoft},reference:{marginTop:4,color:colors.text,fontSize:10},coordinates:{flexDirection:'row',gap:spacing.sm},flex:{flex:1},message:{color:colors.primaryDark,fontWeight:'800',textAlign:'center'}});
