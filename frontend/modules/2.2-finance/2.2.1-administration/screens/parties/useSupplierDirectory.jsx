import {useEffect,useState} from 'react';
import {loadSupplierDirectory} from './supplierSearch.mjs';

export default function useSupplierDirectory({workspace,endpoint,enabled,reload}){
  const {tenant,company,request,denied}=workspace;
  const scope=JSON.stringify([tenant,company,reload]);
  const [state,setState]=useState({scope:null,items:null,error:null});
  useEffect(()=>{
    if(!enabled||state.scope===scope&&state.items!==null)return;
    let live=true;setState({scope,items:null,error:null});
    loadSupplierDirectory({request,endpoint,tenant,company,isCurrent:()=>live})
      .then(items=>{if(live&&items!==null)setState({scope,items,error:null});})
      .catch(error=>{if(!live||error.name==='AbortError')return;setState({scope,items:null,error:true});if(error.status===403)denied();});
    return()=>{live=false;};
  },[enabled,scope]);
  const current=state.scope===scope?state:{items:null,error:null};
  return {...current,loading:enabled&&current.items===null&&!current.error};
}
