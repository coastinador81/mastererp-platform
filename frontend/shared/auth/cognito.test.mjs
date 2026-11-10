import test from 'node:test';
import assert from 'node:assert/strict';
import {pkceChallenge, authorizationRequest, completeLogin, restoreSession, clearSession, loadSpaces} from './cognito.mjs';

const config = {clientId:'test-client',loginBaseUrl:'https://identity.invalid',
  callbackUrl:'https://dev.uonify.com/auth/callback',logoutUrl:'https://dev.uonify.com/',
  scopes:['openid','mastererp-dev/identity.spaces.read'],apiUrl:'https://api.invalid'};
// app-dev.uonify.com: alias de transición; conserva su propio callback mientras exista.
const alias = {...config,callbackUrl:'https://app-dev.uonify.com/auth/callback',logoutUrl:'https://app-dev.uonify.com/'};

test('S256 matches RFC 7636 vector', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('public authorization-code request has random state and S256; no secret', async () => {
  const first=await authorizationRequest(config), second=await authorizationRequest(config);
  const url=new URL(first.url);
  assert.notEqual(first.state,second.state);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.has('client_secret'),false);
  assert.equal(url.searchParams.get('code_challenge'),await pkceChallenge(first.verifier));
});

test('callback validates state, consumes transaction, removes URL; tokens stay in memory', async () => {
  const store=new Map();
  globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  let cleaned=false;
  globalThis.window={history:{replaceState:()=>{cleaned=true;}}};
  let calls=0;
  globalThis.fetch=async (url,options)=>{
    calls++;
    assert.equal(options.credentials,'omit');
    assert.equal(options.body.get('code_verifier'),'test-verifier');
    return {ok:true,json:async()=>({token_type:'Bearer',access_token:'test-only-token',id_token:'test-only-id-token',refresh_token:'test-refresh',expires_in:900})};
  };
  const tx={state:'expected',verifier:'test-verifier',createdAt:Date.now(),
    clientId:config.clientId,callbackUrl:config.callbackUrl};
  store.set('mastererp.dev.pkce',JSON.stringify(tx));
  await assert.rejects(completeLogin(config,config.callbackUrl+'?code=test-code&state=wrong'));
  assert.equal(calls,0);
  assert.equal(store.size,0);
  store.set('mastererp.dev.pkce',JSON.stringify(tx));
  await completeLogin(config,config.callbackUrl+'?code=test-code&state=expected');
  assert.equal(calls,1);
  assert.equal(cleaned,true);
  assert.equal(store.get('mastererp.dev.returning'),'true');
  assert.match(store.get('mastererp.dev.refresh'),/test-refresh/);
  await assert.rejects(completeLogin(config,config.callbackUrl+'?code=replay&state=expected'));
  assert.equal(calls,1);
  clearSession();
  await assert.rejects(loadSpaces(config));
});

test('space discovery uses bearer token and server list; failures never become mock spaces', async () => {
  const store=new Map();
  globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  globalThis.window={history:{replaceState:()=>{}}};
  store.set('mastererp.dev.pkce',JSON.stringify({state:'spaces-state',verifier:'test-verifier',
    createdAt:Date.now(),clientId:config.clientId,callbackUrl:config.callbackUrl}));
  globalThis.fetch=async()=>({ok:true,json:async()=>({token_type:'Bearer',access_token:'test-only-token',id_token:'test-only-id-token',refresh_token:'test-refresh',expires_in:900})});
  await completeLogin(config,config.callbackUrl+'?code=test-code&state=spaces-state');
  let spaces=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,config.apiUrl+'/v1/uonify/spaces');
    assert.equal(options.headers.Authorization,'Bearer test-only-token');
    assert.equal(options.cache,'no-store');
    return {ok:true,json:async()=>({spaces})};
  };
  assert.deepEqual(await loadSpaces(config),[]);
  spaces=[{id:'test-tenant-a',name:'A'},{id:'test-tenant-b',name:'B'}];
  assert.deepEqual(await loadSpaces(config),spaces);
  globalThis.fetch=async()=>({ok:false,status:404});
  await assert.rejects(loadSpaces(config),/no está disponible/);
  clearSession();
});

test('reload restores tokens with Cognito refresh and logout removes persistence', async () => {
  const store=new Map([['mastererp.dev.refresh',JSON.stringify({refreshToken:'saved-refresh',clientId:config.clientId,callbackUrl:config.callbackUrl,createdAt:Date.now()})]]);
  globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  globalThis.fetch=async(url,options)=>{
    assert.equal(new URL(url).pathname,'/oauth2/token');
    assert.equal(options.body.get('grant_type'),'refresh_token');
    assert.equal(options.body.get('refresh_token'),'saved-refresh');
    return {ok:true,json:async()=>({token_type:'Bearer',access_token:'restored-access',id_token:'restored-id',expires_in:900})};
  };
  assert.equal(await restoreSession(config),true);
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer restored-access');
    return {ok:true,json:async()=>({spaces:[{id:'tenant',name:'Tenant'}]})};
  };
  assert.equal((await loadSpaces(config))[0].id,'tenant');
  clearSession();
  assert.equal(store.has('mastererp.dev.refresh'),false);
});

test('refresh accepts an OAuth response without id token and persists token rotation', async () => {
  const store=new Map([['mastererp.dev.refresh',JSON.stringify({refreshToken:'old-refresh',clientId:config.clientId,callbackUrl:config.callbackUrl,createdAt:Date.now()})]]);
  globalThis.sessionStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  globalThis.fetch=async()=>({ok:true,json:async()=>({token_type:'Bearer',access_token:'rotated-access',refresh_token:'new-refresh',expires_in:900})});
  assert.equal(await restoreSession(config),true);
  assert.equal(JSON.parse(store.get('mastererp.dev.refresh')).refreshToken,'new-refresh');
  globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer rotated-access');return{ok:true,json:async()=>({spaces:[]})}};
  assert.deepEqual(await loadSpaces(config),[]);
  clearSession();
});

test('configured auth timeout aborts a stalled Cognito refresh', async () => {
  const timedConfig={...config,requestTimeoutMs:5};
  const store=new Map([['mastererp.dev.refresh',JSON.stringify({refreshToken:'saved-refresh',clientId:config.clientId,callbackUrl:config.callbackUrl,createdAt:Date.now()})]]);
  globalThis.sessionStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  });
  await assert.rejects(restoreSession(timedConfig),/La conexión está tardando demasiado/);
  clearSession();
});

test('transition alias app-dev still completes login with its own callback', async () => {
  const store=new Map();
  globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  globalThis.window={history:{replaceState:()=>{}}};
  let redirect=null;
  globalThis.fetch=async(url,options)=>{
    redirect=options.body.get('redirect_uri');
    return {ok:true,json:async()=>({token_type:'Bearer',access_token:'alias-token',id_token:'alias-id-token',refresh_token:'alias-refresh',expires_in:900})};
  };
  store.set('mastererp.dev.pkce',JSON.stringify({state:'alias-state',verifier:'test-verifier',
    createdAt:Date.now(),clientId:alias.clientId,callbackUrl:alias.callbackUrl}));
  await completeLogin(alias,alias.callbackUrl+'?code=test-code&state=alias-state');
  assert.equal(redirect,'https://app-dev.uonify.com/auth/callback');
  clearSession();
});

test('callback arriving on another origin is rejected before any token exchange', async () => {
  const store=new Map();
  globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  globalThis.window={history:{replaceState:()=>{}}};
  let calls=0;
  globalThis.fetch=async()=>{calls++;return {ok:false,status:500};};
  store.set('mastererp.dev.pkce',JSON.stringify({state:'cross-state',verifier:'test-verifier',
    createdAt:Date.now(),clientId:config.clientId,callbackUrl:config.callbackUrl}));
  await assert.rejects(completeLogin(config,alias.callbackUrl+'?code=test-code&state=cross-state'));
  assert.equal(calls,0);
  assert.equal(store.size,0);
});
