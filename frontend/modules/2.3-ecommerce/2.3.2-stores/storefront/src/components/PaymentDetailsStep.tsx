import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cleanPayer, payerError } from '../payer.mjs';
import { formatVes } from '../exchange-rate.mjs';
import { colors, radii, spacing } from '../theme';
import type { PayerDetails, PaymentMethod, PaymentRecipient, StoreConfiguration } from '../types';
import { bankNameForCode, formatPagoMovilClipboard, formatTransferClipboard, parseVenezuelanDocument, VENEZUELAN_BANKS } from '../venezuelan-banks.mjs';

type Props={configuration?:StoreConfiguration;method:PaymentMethod;phase:'instructions'|'report';reference:string;payer:PayerDetails;total:number;onReference:(value:string)=>void;onPayer:(value:PayerDetails)=>void};
const recipientFor=(method:PaymentMethod,configuration?:StoreConfiguration):PaymentRecipient|null|undefined=>method==='mobile'?configuration?.paymentDetails?.mobilePayment:configuration?.paymentDetails?.bankTransfer;
const amount=(total:number,configuration?:StoreConfiguration)=>{const rate=Number(configuration?.exchangeRate?.rate);return Number.isFinite(rate)&&rate>0?total*rate:null;};

async function copyText(value:string){
  if(typeof navigator!=='undefined'&&navigator.clipboard){await navigator.clipboard.writeText(value);return;}
  if(typeof document==='undefined')throw new Error('Clipboard unavailable');
  const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw new Error('Clipboard unavailable');
}

export function PaymentDetailsStep({configuration,method,phase,reference,payer,total,onReference,onPayer}:Props){
  const recipient=recipientFor(method,configuration),amountVes=amount(total,configuration),[copied,setCopied]=useState(''),clean=cleanPayer(method,payer),invalid=payerError(method,clean);
  const all=useMemo(()=>recipient&&amountVes!=null?(method==='mobile'?formatPagoMovilClipboard({bankCode:recipient.bankCode,phone:recipient.phone||'',document:recipient.document,amount:amountVes}):formatTransferClipboard({accountNumber:recipient.accountNumber||'',document:recipient.document,amount:amountVes})):null,[amountVes,method,recipient]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(''),1800);return()=>clearTimeout(timer);},[copied]);
  const copy=async(label:string,value:string)=>{try{await copyText(value);setCopied(`${label} copiado`);}catch{setCopied('No se pudo copiar. Mantén pulsado el dato.');}};
  if(!recipient)return <Text style={styles.error}>La tienda no tiene configurados los datos de este método de pago.</Text>;
  const parsed=parseVenezuelanDocument(recipient.document),bank=bankNameForCode(recipient.bankCode,recipient.bankName);
  if(phase==='report')return <View style={styles.wrap}>
    <View><Text style={styles.title}>Confirma el pago realizado</Text><Text style={styles.reportHint}>Estos datos permitirán que Finanzas valide tu pago.</Text></View>
    <View style={styles.lockedCard}>
      <LockedRow label="Fecha" value={new Intl.DateTimeFormat('es-VE',{dateStyle:'long'}).format(new Date())}/>
      <LockedRow label="Monto" value={amountVes==null?'Tasa no disponible':formatVes(amountVes)}/>
    </View>
    <View style={styles.form}>
      <BankSelector value={payer.bankCode} onChange={bankCode=>onPayer({...payer,bankCode})}/>
      <Field label="Cédula o RIF" value={payer.document} onChangeText={document=>onPayer({...payer,document})} autoCapitalize="characters" maxLength={14} placeholder="Ej. V12345678"/>
      {method==='mobile'?<Field label="Teléfono desde el que pagaste" value={payer.phone||''} onChangeText={phone=>onPayer({...payer,phone})} inputMode="tel" maxLength={14} placeholder="Ej. 04121234567"/>:null}
      {method==='transfer'?<Field label="Titular de la cuenta (opcional)" value={payer.holder||''} onChangeText={holder=>onPayer({...payer,holder})} maxLength={120} placeholder="Nombre y apellido"/>:null}
      <Field label="Número de referencia" value={reference} onChangeText={value=>onReference(value.replace(/\D/g,''))} inputMode="numeric" maxLength={40} placeholder="Ej. 12345678"/>
      {invalid?<Text style={styles.error}>{invalid}</Text>:null}
    </View>
  </View>;
  return <View style={styles.wrap}>
    <View><Text style={styles.title}>Paga a la tienda</Text><Text style={styles.reportHint}>Copia los datos, realiza el pago desde tu banco y luego pulsa “Ya pagué”.</Text></View>
    <View style={styles.card}>
      <CopyRow label="Documento" value={parsed?.display||recipient.document} copyValue={parsed?`${parsed.type}${parsed.number}`:recipient.document} onCopy={copy}/>
      {recipient.phone?<CopyRow label="Teléfono" value={recipient.phone} onCopy={copy}/>:null}
      <CopyRow label="Banco" value={`${recipient.bankCode} · ${bank}`} copyValue={recipient.bankCode} onCopy={copy}/>
      {recipient.accountNumber?<CopyRow label="Número de cuenta" value={recipient.accountNumber} copyValue={recipient.accountNumber.replace(/\D/g,'')} onCopy={copy}/>:null}
      {recipient.accountHolder?<CopyRow label="Titular" value={recipient.accountHolder} onCopy={copy}/>:null}
      {amountVes!=null?<CopyRow label="Monto" value={formatVes(amountVes)} copyValue={amountVes.toFixed(2)} onCopy={copy}/>:<Text style={styles.rateWarning}>La tienda debe publicar una tasa de cambio vigente antes de copiar el monto.</Text>}
      <View style={styles.copyAllWrap}><Pressable disabled={!all} style={[styles.copyAll,!all&&styles.disabled]} onPress={()=>all&&void copy('Todos los datos',all)}><Ionicons name="copy-outline" size={20} color={colors.surface}/><Text style={styles.copyAllText}>Copiar todos</Text></Pressable></View>
    </View>
    {copied?<Text style={styles.copied} accessibilityLiveRegion="polite">{copied}</Text>:null}
  </View>;
}

function CopyRow({label,value,copyValue=value,onCopy}:{label:string;value:string;copyValue?:string;onCopy:(label:string,value:string)=>Promise<void>}){return <View style={styles.row}><View style={styles.flex}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View><Pressable style={styles.copyButton} accessibilityLabel={`Copiar ${label}`} onPress={()=>void onCopy(label,copyValue)}><Ionicons name="copy-outline" size={20} color={colors.primaryDark}/></Pressable></View>;}
function LockedRow({label,value}:{label:string;value:string}){return <View style={styles.lockedRow}><View><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View><Ionicons name="lock-closed-outline" size={17} color={colors.muted}/></View>;}

function BankSelector({value,onChange}:{value:string;onChange:(value:string)=>void}){const[open,setOpen]=useState(false),selected=VENEZUELAN_BANKS.find(bank=>bank.code===value);return <View><Text style={styles.fieldLabel}>Banco desde el que pagas</Text><Pressable style={styles.selector} onPress={()=>setOpen(current=>!current)} accessibilityRole="button" accessibilityState={{expanded:open}}><Text style={selected?styles.selectorText:styles.placeholder}>{selected?`${selected.code} · ${selected.name}`:'Selecciona tu banco'}</Text><Ionicons name={open?'chevron-up':'chevron-down'} size={18} color={colors.muted}/></Pressable>{open?<ScrollView style={styles.bankList} nestedScrollEnabled keyboardShouldPersistTaps="handled">{VENEZUELAN_BANKS.map(bank=><Pressable key={bank.code} style={[styles.bankOption,bank.code===value&&styles.bankSelected]} onPress={()=>{onChange(bank.code);setOpen(false);}}><Text style={styles.bankText}>{bank.code} · {bank.name}</Text></Pressable>)}</ScrollView>:null}</View>;}

function Field({label,...props}:React.ComponentProps<typeof TextInput>&{label:string}){return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} placeholderTextColor={colors.muted} style={styles.input}/></View>;}

const styles=StyleSheet.create({wrap:{gap:spacing.md},card:{overflow:'hidden',borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.surface},row:{minHeight:66,flexDirection:'row',alignItems:'center',paddingLeft:spacing.md,borderBottomWidth:1,borderBottomColor:colors.line},flex:{flex:1},label:{color:colors.muted,fontSize:11,fontWeight:'700'},value:{marginTop:3,color:colors.ink,fontSize:15,fontWeight:'800'},copyButton:{width:48,height:48,alignItems:'center',justifyContent:'center'},copyAllWrap:{padding:spacing.md},copyAll:{minHeight:50,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:radii.md,backgroundColor:colors.ink},copyAllText:{color:colors.surface,fontWeight:'900'},disabled:{opacity:.45},rateWarning:{padding:spacing.md,color:colors.danger,fontSize:11,lineHeight:17},form:{gap:8,padding:spacing.md,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.surface},title:{color:colors.ink,fontSize:22,fontWeight:'900'},reportHint:{marginTop:5,color:colors.muted,fontSize:12,lineHeight:18},lockedCard:{overflow:'hidden',borderWidth:1,borderColor:colors.line,borderRadius:radii.md},lockedRow:{minHeight:66,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:spacing.md,borderBottomWidth:1,borderBottomColor:colors.line,backgroundColor:colors.canvas},fieldLabel:{marginTop:6,marginBottom:5,color:colors.ink,fontSize:12,fontWeight:'800'},input:{minHeight:48,paddingHorizontal:spacing.md,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,color:colors.ink,backgroundColor:colors.canvas},selector:{minHeight:50,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,paddingHorizontal:spacing.md,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.canvas},selectorText:{flex:1,color:colors.ink,fontSize:13},placeholder:{flex:1,color:colors.muted,fontSize:13},bankList:{maxHeight:320,marginTop:5,borderWidth:1,borderColor:colors.line,borderRadius:radii.md,backgroundColor:colors.surface},bankOption:{minHeight:43,justifyContent:'center',paddingHorizontal:spacing.md,borderBottomWidth:1,borderBottomColor:colors.line},bankSelected:{backgroundColor:colors.primarySoft},bankText:{color:colors.ink,fontSize:12},error:{color:colors.danger,fontSize:12,fontWeight:'800'},copied:{color:colors.primaryDark,fontSize:12,fontWeight:'900',textAlign:'center'}});
