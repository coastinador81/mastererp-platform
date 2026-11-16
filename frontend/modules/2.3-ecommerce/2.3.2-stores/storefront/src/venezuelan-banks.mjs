export const VENEZUELAN_BANKS = Object.freeze([
  {code:'0102',name:'Banco de Venezuela'},
  {code:'0104',name:'Venezolano de Crédito'},
  {code:'0105',name:'Mercantil Banco'},
  {code:'0108',name:'BBVA Provincial'},
  {code:'0114',name:'Bancaribe'},
  {code:'0115',name:'Banco Exterior'},
  {code:'0128',name:'Banco Caroní'},
  {code:'0134',name:'Banesco'},
  {code:'0137',name:'Banco Sofitasa'},
  {code:'0138',name:'Banco Plaza'},
  {code:'0146',name:'Bangente'},
  {code:'0151',name:'BFC Banco Fondo Común'},
  {code:'0156',name:'100% Banco'},
  {code:'0157',name:'DelSur Banco Universal'},
  {code:'0163',name:'Banco del Tesoro'},
  {code:'0166',name:'Banco Agrícola de Venezuela'},
  {code:'0168',name:'Bancrecer'},
  {code:'0169',name:'R4 Banco Microfinanciero'},
  {code:'0171',name:'Banco Activo'},
  {code:'0172',name:'Bancamiga'},
  {code:'0173',name:'Banco Internacional de Desarrollo'},
  {code:'0174',name:'Banplus'},
  {code:'0175',name:'Banco Digital de los Trabajadores'},
  {code:'0177',name:'BANFANB'},
  {code:'0178',name:'N58 Banco Digital'},
  {code:'0191',name:'Banco Nacional de Crédito'},
]);

export const bankNameForCode=(code,fallback='Banco venezolano')=>VENEZUELAN_BANKS.find(bank=>bank.code===code)?.name||fallback;

export function parseVenezuelanDocument(value=''){
  const match=value.trim().toUpperCase().match(/^([VEJGRP])[-\s]?([0-9]{5,12})$/i);
  return match?{type:match[1],number:match[2],display:`${match[1]}-${match[2]}`}:null;
}

export function normalizeVenezuelanPhone(value=''){
  const digits=value.replace(/\D/g,'');
  return digits.startsWith('58')&&digits.length===12?`0${digits.slice(2)}`:digits;
}

export function formatPagoMovilClipboard({bankCode,phone,document,amount}){
  const parsed=parseVenezuelanDocument(document),normalizedPhone=normalizeVenezuelanPhone(phone);
  if(!parsed||!/^0(412|414|416|424|426)[0-9]{7}$/.test(normalizedPhone)||!/^\d{4}$/.test(bankCode)||!Number.isFinite(amount)||amount<=0)return null;
  return [bankCode,`${parsed.type}${parsed.number}`,normalizedPhone,amount.toFixed(2)].join('\n');
}

export function formatTransferClipboard({accountNumber,document,amount}){
  const parsed=parseVenezuelanDocument(document),account=String(accountNumber||'').replace(/\D/g,'');
  if(!parsed||!/^\d{10,30}$/.test(account)||!Number.isFinite(amount)||amount<=0)return null;
  return [account,`${parsed.type}${parsed.number}`,amount.toFixed(2)].join('\n');
}
