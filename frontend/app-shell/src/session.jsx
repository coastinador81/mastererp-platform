import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {login, logout, completeLogin, restoreSession, authorizedFetch, clearSession, sessionExpiresAt} from '../../shared/auth/cognito.mjs';
import {flushSync} from 'react-dom';
import {workspacePath,financeUrl} from './financeRoutes.mjs';
import baseConfig from '../../modules/0-uonify/auth-config.json';
const SessionContext = createContext(null);
export const useWorkspace = () => useContext(SessionContext);
const allowedOrigins = ['https://app-dev.uonify.com', 'https://finanzas-dev.uonify.com', 'https://ecom-dev.uonify.com'];
const origin = allowedOrigins.includes(window.location.origin) ? window.location.origin : 'https://app-dev.uonify.com';
const standalone = origin !== 'https://app-dev.uonify.com';
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
    const result=await request(config.apiUrl+'/v1/uonify/spaces');
    if(!Array.isArray(result.spaces)||result.spaces.some(s=>typeof s.id!=='string'||typeof s.name!=='string')) throw new Error('invalid_context');
    sessionStorage.removeItem('mastererp.dev.returning');setSpaces(result.spaces);setSignedIn(true);setAuthenticating(false);
    let candidate={};try{candidate=JSON.parse(sessionStorage.getItem('mastererp.dev.selection')||'{}');}catch{}
    if(result.spaces.some(x=>x.id===candidate.tenant))setTenant(candidate.tenant);
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
      if(c?.tenant_id!==tenant || !Array.isArray(c.companies)||!Array.isArray(c.permissions)||!Array.isArray(c.modules)||c.companies.some(x=>typeof x.id!=='string'||typeof x.name!=='string')||c.permissions.some(x=>typeof x!=='string')||c.modules.some(x=>typeof x!=='string'))throw new Error('invalid_context');
      setSpaces(result.spaces);setContext(c);
      setCompany(previous=>{
        let candidate={};try{candidate=JSON.parse(sessionStorage.getItem('mastererp.dev.selection')||'{}');}catch{}
        const desired=previous||(candidate.tenant===tenant?candidate.company:'');
        const selected=c.companies.some(x=>x.id===desired)?desired:(c.companies.length===1?c.companies[0].id:'');
        sessionStorage.setItem('mastererp.dev.selection',JSON.stringify({tenant,company:selected}));return selected;
      });
    } catch(e) {
      if(e.name==='AbortError')return;
      invalidate();sessionStorage.removeItem('mastererp.dev.selection');setCompany('');setContext(null);setLoading(false);setError(e.status===403?'Acceso denegado a este espacio.':'No se pudo cargar el contexto autorizado.');
      if(e.status===403)request(config.apiUrl+'/v1/uonify/spaces').then(r=>{setSpaces(r.spaces);if(!r.spaces.some(x=>x.id===tenant))setTenant('');}).catch(()=>{});
    } finally {if(epoch===generation.current)setLoading(false);}
  };
  useEffect(()=>{refresh();},[tenant,signedIn]);
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
