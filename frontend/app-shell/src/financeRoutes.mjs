const base='/modulos/finanzas/administracion/proveedores';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function workspacePath(location,independent=false){
 const hash=location.hash?.slice(1);
 if(hash&&hash!=='/')return hash;
 if(independent){
  const query=new URLSearchParams(location.search);
  if(query.get('vista')==='proveedores'){
   const action=query.get('accion'),id=query.get('id');
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
 if(path===base)return '/?vista=proveedores';
 if(path===base+'/nuevo')return '/?vista=proveedores&accion=crear';
 if(path.startsWith(base+'/')){
  const [id,mode,...rest]=path.slice(base.length+1).split('/');
  if(uuid.test(id)&&!rest.length&&(!mode||mode==='editar'))return '/?vista=proveedores'+(mode?'&accion=editar':'')+'&id='+id;
 }
 return null;
}
