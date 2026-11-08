import { useEffect } from 'react';
import { create } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { currentAccountEmail, useSession } from '@/modules/auth';
import { useComposerStore } from './composerStore';
import { noticeInConversation } from './conversationNotice';
import { useWorkspaceStore } from './workspaceStore';
import { googleSelectionLabel, type GoogleOptions, type GooglePreferences } from '../model/googleOptions';
export { googleSelectionEfforts, type GoogleEffort, type GoogleOptions, type GooglePreferences } from '../model/googleOptions';
export const useGooglePreferences = create<{account:string|null;data:GoogleOptions|null;saving:boolean}>(()=>({account:null,data:null,saving:false}));
export function useGoogleOptions() {
  const {user}=useSession();
  const account=user?.email??null;
  const query=useQuery({queryKey:['uony-options',account],queryFn:async({signal})=>{
    if(!account || signal.aborted || account!==currentAccountEmail())throw new DOMException('La cuenta ha cambiado.','AbortError');
    const data=await api.get<GoogleOptions>('/uony/options',{signal});
    if(signal.aborted || account!==currentAccountEmail())throw new DOMException('La cuenta ha cambiado.','AbortError');
    return data;
  },enabled:!!account && account===currentAccountEmail(),retry:false,refetchOnWindowFocus:false});
  useEffect(()=>{
    if(account!==currentAccountEmail())return;
    if(!account || query.isFetching || query.isError){useGooglePreferences.setState({account:null,data:null,saving:false});return;}
    if(query.data)useGooglePreferences.setState({account,data:query.data,saving:false});
  },[query.data,account,query.isFetching,query.isError]);
  return query;
}
export async function saveGooglePreferences(preferences:GooglePreferences) {
  const account=currentAccountEmail();
  const selection=useGooglePreferences.getState();
  if(!account || selection.account!==account || !selection.data || selection.saving)return;
  useGooglePreferences.setState({saving:true});
  try {
    const saved=await api.put<GooglePreferences>('/uony/preferences',preferences);
    if(account!==currentAccountEmail() || useGooglePreferences.getState().account!==account)return;
    const data=useGooglePreferences.getState().data;
    if(data)useGooglePreferences.setState({data:{...data,preferences:saved}});
    useComposerStore.getState().setStatus('');
  } catch {
    // Maqueta aprobada por el dueño (22-10-2026): nada bajo la caja; el selector sigue en lo
    // guardado (data solo cambia al guardar) y Uony lo dice en la conversación abierta.
    const data=useGooglePreferences.getState().data;
    if(account===currentAccountEmail())noticeInConversation(useWorkspaceStore.getState().activeThreadId,
      `No he podido guardar el cambio de IA. Sigo con ${data?googleSelectionLabel(data,data.preferences):'la IA que tenías'}; puedes volver a elegirlo cuando quieras.`);
  }
  finally { if(account===currentAccountEmail())useGooglePreferences.setState({saving:false}); }
}
if(typeof window!=='undefined')window.addEventListener('uonify:identity-changed',()=>useGooglePreferences.setState({account:null,data:null,saving:false}));
