import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {login, logout, completeLogin, restoreSession, authorizedFetch, clearSession, sessionExpiresAt} from '../../shared/auth/cognito.mjs';
import {flushSync} from 'react-dom';
import {workspacePath,financeUrl} from './financeRoutes.mjs';
import {savedSelection,selectedCompany,validContext,validSpaces} from './workspaceContext.mjs';
import baseConfig from '../../modules/0-uonify/auth-config.json';
const SessionContext = createContext(null);
export const useWorkspace = () => useContext(SessionContext);
// dev.uonify.com es la entrada canónica; app-dev.uonify.com sigue como alias de transición (misma app, no standalone).
const primaryOrigins = ['https://dev.uonify.com', 'https://app-dev.uonify.com'];
const allowedOrigins = [...primaryOrigins, 'https://finanzas-dev.uonify.com', 'https://ecom-dev.uonify.com'];
const origin = allowedOrigins.includes(window.location.origin) ? window.location.origin : 'https://dev.uonify.com';
const standalone = !primaryOrigins.includes(origin);
export const config = {...baseConfig, apiUrl:standalone?origin:baseConfig.apiUrl, adminApiUrl:standalone?origin:baseConfig.adminApiUrl, callbackUrl:origin + '/auth/callback', logoutUrl:origin + '/'};
export function WorkspaceProvider({children}) {
  const [signedIn,setSignedIn] = useState(false), [spaces,setSpaces] = useState([]);
  const [tenant,setTenant] = useState(''), [company,setCompany] = useState(''), [context,setContext] = useState(null);
  const [loading,setLoading] = useState(false), [authenticating,setAuthenticating] = useState(true), [error,setError] = useState('');
  const requests = useRef(new Set()), generation = useRef(0), started = useRef(false);
  const invalidate = () => { generation.current++; for (const c of requests.current) c.abort(); requests.current.clear(); };
  const end = (message='Tu sesión ha finalizado. Vuelve a acceder.') => {
    invalidate(); clearSession(); setSignedIn(false); setSpaces([]); setTenant(''); setCompany(''); setContext(null); setError(message); setLoading(false); setAuthenticating(false);
  };
  const request = async (url,options={}) => {
    const controller = new AbortController(), epoch=generation.current; requests.current.add(controller);
    try {
      const result=await authorizedFetch(url,{...options,signal:controller.signal});
      if(epoch!==generation.current) throw new DOMException('Context changed','AbortError');
      return result;
    } catch(e) {
      if(e.status===401) end();
      throw e;
    } finally {requests.current.delete(controller);}
  };
  const discover = async () => {
    const candidate=savedSelection(), base=config.apiUrl+'/v1/uonify/spaces';
    let result;
    try {result=await request(candidate.tenant?base+'?tenant_id='+encodeURIComponent(candidate.tenant):base);}
    catch(error){
      if(!candidate.tenant||error.status!==403)throw error;
      sessionStorage.removeItem('mastererp.dev.selection');result=await request(base);
    }
    if(!validSpaces(result))throw new Error('invalid_context');
    sessionStorage.removeItem('mastererp.dev.returning');setSpaces(result.spaces);setSignedIn(true);setAuthenticating(false);
    if(candidate.tenant&&validContext(result.context,candidate.tenant)){
      const nextCompany=selectedCompany(result.context,candidate.company);
      setTenant(candidate.tenant);setContext(result.context);setCompany(nextCompany);
      sessionStorage.setItem('mastererp.dev.selection',JSON.stringify({tenant:candidate.tenant,company:nextCompany}));
    } else if(result.spaces.some(x=>x.id===candidate.tenant))setTenant(candidate.tenant);
    else if(result.spaces.length===1)setTenant(result.spaces[0].id);
  };
  useEffect(()=>{
    if(started.current)return;started.current=true;
    (async()=>{
      try {
        if(window.location.pathname==='/auth/callback') {await completeLogin(config);await discover();window.dispatchEvent(new HashChangeEvent('hashchange'));}
        else if(await restoreSession(config)) await discover();
      } catch {end('No se pudo validar el acceso. Vuelve a intentarlo.');}
      finally {setAuthenticating(false);}
    })();
    return invalidate;
  },[]);
  useEffect(()=>{
    if(!signedIn)return;
    const timer=setInterval(async()=>{if(sessionExpiresAt()-Date.now()<=60000&&!await restoreSession(config))end();},10000);
    return ()=>clearInterval(timer);
  },[signedIn]);
  const selectTenant = value => {if(value===tenant)return;invalidate();setCompany('');setContext(null);setLoading(false);setError('');sessionStorage.setItem('mastererp.dev.selection',JSON.stringify({tenant:value,company:''}));setTenant(value);};
  const selectCompany = value => {if(value===company)return;invalidate();setCompany('');setError('');const selected=context?.companies.some(c=>c.id===value)?value:'';sessionStorage.setItem('mastererp.dev.selection',JSON.stringify({tenant,company:selected}));setCompany(selected);};
  const refresh = async (background=false) => {
    if(!tenant || !signedIn)return;
    if(!background){invalidate();setLoading(true);setContext(null);setError('');}
    const epoch=generation.current;
    try {
      const result=await request(config.apiUrl+'/v1/uonify/spaces?tenant_id='+encodeURIComponent(tenant));
      const c=result.context;
      if(!validSpaces(result)||!validContext(c,tenant))throw new Error('invalid_context');
      setSpaces(result.spaces);setContext(c);
      setCompany(previous=>{
        const candidate=savedSelection(),desired=previous||(candidate.tenant===tenant?candidate.company:'');
        const selected=selectedCompany(c,desired);
        sessionStorage.setItem('mastererp.dev.selection',JSON.stringify({tenant,company:selected}));return selected;
      });
    } catch(e) {
      if(e.name==='AbortError')return;
      invalidate();sessionStorage.removeItem('mastererp.dev.selection');setCompany('');setContext(null);setLoading(false);setError(e.status===403?'Acceso denegado a este espacio.':'No se pudo cargar el contexto autorizado.');
      if(e.status===403)request(config.apiUrl+'/v1/uonify/spaces').then(r=>{setSpaces(r.spaces);if(!r.spaces.some(x=>x.id===tenant))setTenant('');}).catch(()=>{});
    } finally {if(epoch===generation.current)setLoading(false);}
  };
  useEffect(()=>{if(context?.tenant_id!==tenant)refresh();},[tenant,signedIn,context?.tenant_id]);
  const beginLogin = () => {
    if(authenticating)return Promise.resolve();
    setAuthenticating(true);setError('');
    if(window.location.origin==='https://finanzas-dev.uonify.com'&&financeUrl(workspacePath(window.location,true))&&financeUrl(workspacePath(window.location,true))!=='/'){
      // Only a logical, non-sensitive route is retained by the existing one-use PKCE transaction.
      window.history.replaceState(null,'','/#'+workspacePath(window.location,true));
    }
    return login(config).catch(error=>{setAuthenticating(false);throw error;});
  };
  const denied = () => {invalidate();sessionStorage.removeItem('mastererp.dev.selection');setContext(null);setCompany('');setError('Acceso denegado. Tus permisos o el módulo pueden haber cambiado.');};
  return <SessionContext.Provider value={{signedIn,spaces,tenant,company,context,loading,authenticating,error,request,selectTenant,selectCompany,refresh,denied,
    startLogin:()=>beginLogin().catch(()=>end('No se pudo iniciar el acceso.')),
    signOut:()=>{flushSync(()=>end(''));logout(config);}}}>{children}</SessionContext.Provider>;
}
