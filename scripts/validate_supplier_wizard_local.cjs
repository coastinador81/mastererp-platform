/* Local browser checks of the real Parties component. Fixtures exist only in this harness. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend'),finance=path.join(frontend,'modules/2.2-finance');
const themed=true;
const output=path.join(finance,'node_modules/.cache','supplier-wizard');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'mastererp-supplier-row-'));
const report={scope:'local browser; synthetic fixtures; no backend/AWS requests',results:[]};
let server,browser;
const source=file=>'/@fs/'+file.replaceAll('\\','/');
const pass=name=>report.results.push({name,status:'passed'});
const luminance=hex=>hex.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(text,surface)=>{const a=luminance(text),b=luminance(surface);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
const first='00009901-0000-0000-0000-000000000001',second='00009901-0000-0000-0000-000000000002';
const parties=path.join(finance,'2.2.1-administration/screens/parties/Parties.jsx');
fs.writeFileSync(path.join(temporary,'index.html'),'<html lang="es"'+(themed?' class="finance-app"':'')+'><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/harness.jsx"></script></html>');
fs.writeFileSync(path.join(temporary,'harness.jsx'),`
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import Parties from ${JSON.stringify(source(parties))};
import {financeUrl,workspacePath} from ${JSON.stringify(source(path.join(frontend,'app-shell/src/financeRoutes.mjs')))};
import ${JSON.stringify(source(path.join(frontend,'app-shell/src/shell.css')))};
${themed?'import '+JSON.stringify(source(path.join(finance,'src/uonify-theme.css')))+';':''}
import FinanceNavigation from ${JSON.stringify(source(path.join(finance,'src/FinanceNavigation.jsx')))};
window.__requests=[];window.__navigations=[];
const records=[${JSON.stringify(first)},${JSON.stringify(second)},'00009901-0000-0000-0000-000000000003'].map((id,index)=>({id,codigo:'PROV-00'+(index+1),nombre:index===1?'Proveedor Río QA 2':'Proveedor QA '+(index+1),roles:['proveedor'],version:1,profile_version:1,catalog_version:1,datos_generales:{numero_identificacion:'DEMO-'+index,email:'qa'+index+'@example.invalid',telefono:'000-000-0000'},contactos:[],condiciones:{}}));
const referenceMode=new URLSearchParams(location.search).has('reference'),manyMode=new URLSearchParams(location.search).has('many');
if(manyMode){records.splice(0,records.length,...Array.from({length:13},(_,index)=>({id:'00009901-0000-0000-0000-'+String(index+1).padStart(12,'0'),codigo:'PROV-'+String(index+1).padStart(3,'0'),nombre:'Proveedor QA '+(index+1),roles:['proveedor']})));}
if(referenceMode){const names=['Suministros Horizonte DEMO','Empaques Río Claro DEMO','Tecnología Andina DEMO','Limpieza Brisa DEMO','Servicios Contables Aurora DEMO','Logística Ruta Azul DEMO','Mantenimiento Faro DEMO','Soluciones Integrales Nube DEMO'];records.splice(0,records.length,...names.map((nombre,index)=>({id:'00009901-0000-0000-0000-'+String(index+1).padStart(12,'0'),codigo:'DEMO-PROV-'+String(index+1).padStart(3,'0'),nombre,roles:['proveedor'],version:1,datos_generales:{numero_identificacion:'DEMO-NO-FISCAL-'+String(index+1).padStart(3,'0'),email:'proveedor'+(index+1)+'@example.invalid',telefono:'000-000-0000'}})));}
const readOnly=new URLSearchParams(location.search).has('readonly');
function Harness(){
 const [menu,setMenu]=useState(false),[company,setCompany]=useState('00009903-0000-0000-0000-000000000001');
 const [route,setRoute]=useState(()=>workspacePath(location,true));
 const capacity=route.includes('/clientes')?'clientes':'proveedores';
 useEffect(()=>{const change=()=>setRoute(workspacePath(location,true));window.addEventListener('popstate',change);window.addEventListener('hashchange',change);return()=>{window.removeEventListener('popstate',change);window.removeEventListener('hashchange',change);};},[]);
 const navigate=destination=>{window.__navigations.push(destination);history.pushState(null,'',financeUrl(destination)||'#'+destination);setRoute(destination);setMenu(false);};
 const workspace={tenant:'00009902-0000-0000-0000-000000000001',company,context:{permissions:readOnly?['administration.parties.read']:['administration.parties.read','administration.parties.write']},denied:()=>{throw Error('Unexpected denial');},request:async(url,options)=>{
 window.__requests.push({url,headers:options.headers,method:options.method,body:options.body});if(options.method){if(window.__fail)throw Object.assign(new Error('Local simulated failure'),{status:503});const body=JSON.parse(options.body);return {data:{...records[0],...body,...body.datos_generales,id:records[0].id}};}const query=new URL(url),id=query.pathname.split('/').at(-1);if(query.searchParams.get('proponer_codigo')==='1'){if(new URLSearchParams(location.search).has('legacy'))throw Object.assign(new Error('Unsupported proposal'),{status:400});return {data:{codigo:'PROV-0004'}};}
 const scoped=query.searchParams.get('company_id')===company&&company.endsWith('0002')?[{id:'00009901-0000-0000-0000-000000000090',codigo:'OTRA-001',nombre:'Proveedor de otra empresa',roles:['proveedor']}]:records;const items=scoped.map(row=>capacity==='clientes'?{...row,nombre:row.nombre.replace('Proveedor','Cliente'),roles:['cliente']}:row);
 const start=query.searchParams.has('after')?items.findIndex(row=>row.id===query.searchParams.get('after'))+1:0;const limit=Number(query.searchParams.get('limit')||10);const pageItems=items.slice(start,start+limit);return {data:items.find(row=>row.id===id)||(manyMode?{items:pageItems,next_cursor:start+limit<items.length?pageItems.at(-1).id:null}:referenceMode||company.endsWith('0002')?{items,next_cursor:null}:{items:query.searchParams.has('after')?[items[2]]:items.slice(0,2),next_cursor:query.searchParams.has('after')?null:${JSON.stringify(second)}})};}};
 return ${themed?`<div className="integrated-app"><header className="integrated-header"><button className="menu-toggle secondary" aria-label="Abrir menú" aria-expanded={menu} onClick={()=>setMenu(!menu)}>☰</button><a className="brand" href="/">Finanzas<span>MasterERP · Desarrollo</span></a><div className="context-controls"><label>Espacio<select aria-label="Espacio"><option>Espacio de prueba</option></select></label><label>Empresa<select aria-label="Empresa" value={company} onChange={event=>setCompany(event.target.value)}><option value="00009903-0000-0000-0000-000000000001">Empresa de prueba</option><option value="00009903-0000-0000-0000-000000000002">Otra empresa de prueba</option></select></label><button className="secondary">Salir</button></div></header><div className="integrated-layout"><aside className={'integrated-nav '+(menu?'is-open':'')} aria-label="Navegación principal"><FinanceNavigation allowed path={route} navigate={navigate}/></aside><main className="integrated-content"><p className="notice">Finanzas · Entorno de desarrollo · Administración</p><Parties key={route+capacity+company} {...{workspace,capacity,navigate}} path={route}/></main></div></div>`:`<main className="integrated-content"><Parties key={route+capacity+company} {...{workspace,capacity,navigate}} path={route}/></main>`};
}createRoot(document.getElementById('root')).render(<Harness/>);
`);


(async()=>{try{
 const {createServer}=await import(pathToFileURL(path.join(finance,'node_modules/vite/dist/node/index.js')).href);
 server=await createServer({configFile:path.join(finance,'vite.config.js'),root:temporary,cacheDir:path.join(temporary,'.vite'),server:{host:'127.0.0.1',port:0,fs:{allow:[frontend,temporary]}},resolve:{alias:{react:path.join(finance,'node_modules/react'),'react-dom':path.join(finance,'node_modules/react-dom')}}});
 await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 fs.mkdirSync(output,{recursive:true});
 await page.goto(origin+'/?vista=proveedores&accion=crear');await page.locator('[name="codigo"]').waitFor();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByRole('heading',{name:'Proveedores',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__requests.filter(x=>x.method).length),0);pass('cancel_does_not_submit');
 await page.getByRole('button',{name:'Crear proveedor',exact:true}).click();
 await page.locator('[name="codigo"]').waitFor();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();assert.equal(await page.locator('[name="nombre"]').evaluate(e=>e.validity.valid),false);assert.equal(await page.locator('[name="codigo"]').isDisabled(),true);assert.equal(await page.locator('[name="codigo"]').inputValue(),'PROV-0004');pass('step1_requires_name_and_displays_readonly_code');
 await page.locator('[name="nombre"]').fill('Proveedor local de prueba');await page.locator('[name="numero_identificacion"]').fill('QA-NO-FISCAL');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'step-1.png'),fullPage:true});
 assert.equal(await page.locator('[name="direccion"]').count(),0);await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('heading',{name:'Dirección y contactos',exact:true}).waitFor();
 assert.equal(await page.locator('.supplier-contact').count(),0);await page.locator('[name="direccion"]').fill('Dirección QA local');await page.getByRole('button',{name:'Añadir contacto',exact:true}).click();await page.locator('[name="contactos.0.email"]').fill('incorrecto');await page.getByRole('button',{name:'Continuar',exact:true}).click();assert.equal(await page.locator('[name="contactos.0.email"]').inputValue(),'incorrecto');assert.equal(await page.locator('[name="contactos.0.email"]').evaluate(e=>e.validity.valid),false);pass('step2_validates_and_preserves_partial_contact');
 await page.locator('[name="contactos.0.email"]').fill('qa@example.invalid');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'step-2.png'),fullPage:true});await page.getByRole('button',{name:'Anterior',exact:true}).click();assert.equal(await page.locator('[name="codigo"]').inputValue(),'PROV-0004');await page.getByRole('button',{name:'Continuar',exact:true}).click();assert.equal(await page.locator('[name="direccion"]').inputValue(),'Dirección QA local');assert.equal(await page.locator('[name="contactos.0.email"]').inputValue(),'qa@example.invalid');pass('previous_next_preserve_fields');
 await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('heading',{name:'Condiciones y revisión',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__requests.filter(x=>x.method).length),0);pass('no_write_before_final_step');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'step-3.png'),fullPage:true});
 await page.evaluate(()=>window.__fail=true);await page.getByRole('button',{name:'Crear proveedor',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Anterior',exact:true}).click();assert.equal(await page.locator('[name="contactos.0.email"]').inputValue(),'qa@example.invalid');await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.evaluate(()=>window.__fail=false);await page.getByRole('button',{name:'Crear proveedor',exact:true}).click();await page.getByRole('button',{name:'Editar',exact:true}).waitFor();const writes=await page.evaluate(()=>window.__requests.filter(x=>x.method));assert.equal(writes.length,2);assert.equal(writes[0].headers['Idempotency-Key'],writes[1].headers['Idempotency-Key']);const payload=JSON.parse(writes[1].body);assert.equal(Object.hasOwn(payload,'codigo'),false);assert.equal(payload.contactos[0].principal,false);pass('save_failure_preserves_payload_and_idempotency_on_retry');
 await page.getByRole('button',{name:'Editar',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Guardar',exact:true}).count(),1);assert.equal(await page.locator('.supplier-wizard-header').count(),0);pass('editing_remains_existing_single_form');
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/?vista=proveedores&accion=crear');await page.locator('[name="codigo"]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});pass('mobile_no_page_overflow');
 await page.goto(origin+'/?vista=proveedores&accion=crear&legacy=1');
 await page.locator('[name="codigo"]:enabled').waitFor();
 await page.locator('[name="codigo"]').fill('QA-MANUAL');
 await page.locator('[name="nombre"]').fill('Proveedor con API anterior');
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByRole('button',{name:'Crear proveedor',exact:true}).click();
 await page.getByRole('button',{name:'Editar',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(window.__requests.find(x=>x.method==='POST').body).codigo),'QA-MANUAL');
 pass('legacy_api_keeps_manual_creation');
 report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}finally{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(browser)await browser.close();if(server)await server.close();}})();
