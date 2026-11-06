import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadAddresses, loadProfile, saveAddress, saveProfile } from '@/api';
import { Screen } from '@/components/Screen';
import { colors, radii, spacing } from '@/theme';
import type { CustomerAddress } from '@/types';

export default function ProfilePage() {
  const [name,setName]=useState(''); const [addresses,setAddresses]=useState<CustomerAddress[]>([]);
  const [label,setLabel]=useState('Casa'); const [address,setAddress]=useState(''); const [message,setMessage]=useState('');
  const reload=()=>Promise.all([loadProfile(),loadAddresses()]).then(([p,a])=>{setName(p.name);setAddresses(a);}).catch(()=>setMessage('No pudimos cargar tu perfil.'));
  useEffect(()=>{void reload();},[]);
  const update=async()=>{try{await saveProfile(name);setMessage('Perfil actualizado.');}catch{setMessage('No pudimos guardar el perfil.');}};
  const add=async()=>{try{await saveAddress({label,address,reference:'',default:addresses.length===0});setAddress('');await reload();setMessage('Dirección guardada.');}catch{setMessage('Revisa la dirección e intenta de nuevo.');}};
  return <Screen><View style={styles.wrap}><Text style={styles.title}>Perfil y direcciones</Text><Text style={styles.label}>Nombre</Text><TextInput value={name} onChangeText={setName} style={styles.input}/><Pressable style={styles.button} onPress={()=>void update()}><Text style={styles.buttonText}>Guardar perfil</Text></Pressable>
    <Text style={styles.heading}>Mis direcciones</Text>{addresses.map(item=><View key={item.id} style={styles.address}><Text style={styles.addressTitle}>{item.label}{item.default?' · Principal':''}</Text><Text style={styles.copy}>{item.address}</Text></View>)}
    <TextInput value={label} onChangeText={setLabel} placeholder="Etiqueta" style={styles.input}/><TextInput value={address} onChangeText={setAddress} placeholder="Dirección completa" multiline style={[styles.input,styles.multiline]}/><Pressable style={styles.button} onPress={()=>void add()}><Text style={styles.buttonText}>Agregar dirección</Text></Pressable>{message?<Text style={styles.message}>{message}</Text>:null}</View></Screen>;
}
const styles=StyleSheet.create({wrap:{maxWidth:720,width:'100%',alignSelf:'center',paddingVertical:40},title:{fontSize:30,fontWeight:'900',color:colors.ink},heading:{marginTop:spacing.xl,marginBottom:spacing.sm,fontSize:22,fontWeight:'900',color:colors.ink},label:{marginTop:spacing.lg,marginBottom:6,color:colors.text,fontWeight:'800'},input:{marginTop:spacing.sm,padding:14,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.surface,color:colors.ink},multiline:{minHeight:90,textAlignVertical:'top'},button:{marginTop:spacing.sm,padding:15,borderRadius:radii.md,backgroundColor:colors.primary,alignItems:'center'},buttonText:{color:colors.surface,fontWeight:'900'},address:{marginBottom:spacing.sm,padding:spacing.md,borderRadius:radii.md,backgroundColor:colors.surface},addressTitle:{fontWeight:'900',color:colors.ink},copy:{marginTop:4,color:colors.muted},message:{marginTop:spacing.md,color:colors.primaryDark,fontWeight:'800'}});
