const limits={nombre:150,cargo:100,email:254,telefono:40};
export const contactHasData=contact=>Object.keys(limits).some(key=>String(contact[key]??'').trim()!=='');

export function contactsFromParty(rows=[]){
 const filtered=rows.filter(contactHasData);
 const principal=filtered.findIndex(row=>row.principal===true);
 return {contacts:filtered.map(({principal,...contact})=>({...contact})),principal};
}

export function contactPayload(contacts,principal=-1){
 return contacts.flatMap((contact,index)=>{
  if(!contactHasData(contact))return [];
  for(const [key,max] of Object.entries(limits)){
   const value=contact[key]??'';
   if(typeof value!=='string'||value.length>max||/[\x00-\x1f]/.test(value))throw new Error('Revisa los campos del contacto '+(index+1)+'.');
   if(key==='email'&&value&&!/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(value))throw new Error('Revisa el correo del contacto '+(index+1)+'.');
  }
  return [{...contact,principal:index===principal}];
 });
}
