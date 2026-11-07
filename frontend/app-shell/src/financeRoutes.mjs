const prefix='/modulos/finanzas/administracion/';
const views=['clientes','proveedores','solicitudes-compra','ordenes-compra','facturas-proveedores','ventas'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function workspacePath(location,independent=false){
 const hash=location.hash?.slice(1);
 if(hash&&hash!=='/')return hash;
 if(independent){
  const query=new URLSearchParams(location.search);
  if(views.includes(query.get('vista'))){
   const base=prefix+query.get('vista');
   const action=query.get('accion'),id=query.get('id');
   if(query.get('vista')==='ventas'&&action)return base;
   if(action==='crear')return base+'/nuevo';
   if(id&&uuid.test(id))return base+'/'+id+(action==='editar'?'/editar':'');
   return base;
  }
  return '/modulos/finanzas';
 }
 return '/';
}
export function financeUrl(path){
 if(path==='/'||path==='/modulos/finanzas')return '/';
 const view=views.find(view=>path===prefix+view||path.startsWith(prefix+view+'/'));
 if(!view)return null;
 const base=prefix+view;
 if(path===base)return '/?vista='+view;
 if(view==='ventas'){
  const id=path.slice(base.length+1);
  return uuid.test(id)?'/?vista=ventas&id='+id:null;
 }
 if(path===base+'/nuevo')return '/?vista='+view+'&accion=crear';
 if(path.startsWith(base+'/')){
  const [id,mode,...rest]=path.slice(base.length+1).split('/');
  if(uuid.test(id)&&!rest.length&&(!mode||mode==='editar'))return '/?vista='+view+(mode?'&accion=editar':'')+'&id='+id;
 }
 return null;
}
