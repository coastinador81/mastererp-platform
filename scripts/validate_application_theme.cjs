/* Real frontend components, local-only fixture doubles. No AWS or business writes. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend'),finance=path.join(frontend,'modules/2.2-finance');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mastererp-theme-'));
const output=path.resolve(process.argv[2]||path.join(root,'.review/theme-validation'));
fs.mkdirSync(output,{recursive:true});
const source=file=>'/@fs/'+path.join(frontend,file).replaceAll('\\','/');
const imp=(name,file)=>`import ${name} from ${JSON.stringify(source(file))};`;
const css=file=>`import ${JSON.stringify(source(file))};`;
const report={scope:'Local browser, actual components with test doubles; no AWS/API persistence',cases:[],external:[]};
let server,browser;
fs.writeFileSync(path.join(temp,'index.html'),'<html lang="es" class="finance-app"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/harness.jsx"></script></html>');
fs.writeFileSync(path.join(temp,'harness.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
${imp('Finance','modules/2.2-finance/src/Finance.jsx')}
${imp('FinanceNavigation','modules/2.2-finance/src/FinanceNavigation.jsx')}
${imp('Orders','modules/2.3-ecommerce/2.3.1-orders/src/Orders.jsx')}
${imp('CatalogPage','modules/2.3-ecommerce/2.3.4-catalog/src/CatalogPage.jsx')}
${imp('PaymentConfiguration','modules/2.3-ecommerce/2.3.2-stores/src/PaymentConfiguration.jsx')}
${imp('PurchasesSummary','modules/2.2-finance/2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/PurchasesSummary.jsx')}
${imp('ApplicationHeader','shared/ui/ApplicationHeader.jsx')}
${imp('RelatedServicesRail','shared/module-launcher/RelatedServicesRail.jsx')}
${imp('{ApplicationAssistantProvider,ApplicationAssistantPanel}','shared/ui/ApplicationAssistant.jsx')}
${imp('ActionDialog','shared/dialog/ActionDialog.jsx')}
${imp('StatusBadge','shared/status-badge/StatusBadge.jsx')}
${css('app-shell/src/shell.css')}
${css('shared/ui/admin-application.css')}
${css('modules/2.3-ecommerce/src/operations.css')}
${css('modules/2.2-finance/src/uonify-theme.css')}
${css('shared/ui/application-header.css')}
${imp('{initializeApplicationTheme}','shared/ui/application-theme.mjs')}
${css('shared/ui/application-theme.css')}
const q=new URLSearchParams(location.search),app=q.get('app')||'finance',screen=q.get('screen')||'proveedores';
document.documentElement.classList.toggle('uonify-brand',app==='finance');
initializeApplicationTheme();
const id='00009901-0000-0000-0000-000000000001',company='00009903-0000-0000-0000-000000000001',tenant='00009902-0000-0000-0000-000000000001';
const permissions=['administration.parties.read','administration.parties.write','administration.purchases.read','administration.purchases.write','administration.read','administration.receipts.validate','catalog.products.read','catalog.products.write','catalog.categories.read','catalog.categories.write','catalog.brands.read','catalog.brands.write','catalog.attributes.read','catalog.attributes.write','catalog.suppliers.read','catalog.suppliers.write','operations.orders.read','operations.orders.write','digital_sales.ecommerce.read','digital_sales.ecommerce.write'];
const party={id,codigo:'PRUEBA-001',nombre:'Proveedor visual de prueba',roles:['proveedor'],version:1,profile_version:1,catalog_version:1,datos_generales:{},contactos:[],condiciones:{}};
const order={id,company_id:company,clase:'orden_compra',numero:'PRUEBA-OC-001',proveedor:'Proveedor visual',fecha:'2026-11-19',moneda:'VES',total:'300.00',estado:'borrador',version:1,lineas:[]};
window.__fixtureCalls=[];
async function request(url,options={}){
 if(options.method&&options.method!=='GET')throw Error('Visual harness never writes');
 window.__fixtureCalls.push(new URL(url).pathname);
 if(url.includes('/v1/administration/compras/opciones'))return {data:{moneda_base:'VES',monedas:[{codigo:'VES',decimales:2}],proveedores:[]}};
 if(url.includes('/v1/administration/compras/ordenes'))return {data:{items:[order],next_cursor:null}};
 if(url.includes('/v1/administration/proveedores'))return {data:{items:[party],next_cursor:null}};
 if(url.includes('/v1/administration/'))return {data:{items:[],next_cursor:null}};
 return {items:[],total:0,next_cursor:null};
}
const context={tenant_id:tenant,modules:['erp.finance','erp.catalog','erp.operations','digital_sales.ecommerce'],permissions,companies:[{id:company,name:'Empresa visual'}]};
const workspace={tenant,company,context,request,denied:()=>{},signedIn:true,authenticating:false,signOut:()=>{},refresh:()=>{}};
const runtime={tenant,company,api:'https://test.invalid',permissions,request};
const route='/modulos/finanzas/administracion/'+screen;
const create=q.has('create');
const navigate=value=>{history.pushState(null,'','#'+value);location.reload();};
let content=app==='finance'?(screen==='resumen'?<PurchasesSummary nodes={[]}/>:<Finance workspace={workspace} path={route+(create?'/nuevo':'')} navigate={navigate}/>):screen==='orders'?<Orders runtime={runtime}/>:screen==='payments'?<PaymentConfiguration runtime={runtime}/>:<CatalogPage runtime={runtime} route="products"/>;
createRoot(document.getElementById('root')).render(<ApplicationAssistantProvider applicationName={app==='finance'?'Finanzas':'Ecommerce'}>
<div className={'integrated-app '+(app==='ecommerce'?'ecommerce-app':'')}><ApplicationHeader currentApp={app} workspace={workspace} brand={app==='finance'?'Finanzas':'Ecommerce'} brandHref="/"/>
<div className="integrated-layout"><div className="finance-service-rail"><RelatedServicesRail currentApp={app}/></div><aside className="integrated-nav"><FinanceNavigation allowed permissions={permissions} path={route} navigate={navigate}/></aside>
<main className="integrated-content">{content}{screen==='dialog'&&<ActionDialog open title="Confirmar acción" description="Diálogo visual de prueba; no ejecuta operaciones." reasonLabel="Observación" onCancel={()=>{}} onConfirm={()=>{}}/>}<div className="theme-status-examples"><StatusBadge tone="success">Activo</StatusBadge><StatusBadge tone="warning">Pendiente</StatusBadge><StatusBadge tone="danger">Error</StatusBadge></div></main><ApplicationAssistantPanel/></div></div></ApplicationAssistantProvider>);
`);
const screens=[['finance','proveedores',false,'Proveedores'],['finance','proveedores',true,'Crear proveedor'],['finance','ordenes-compra',false,'Órdenes de compra'],['finance','ordenes-compra',true,null],['finance','resumen',false,null],['ecommerce','orders',false,'Pedidos'],['ecommerce','products',false,'Productos'],['ecommerce','products',true,null],['ecommerce','payments',false,null],['ecommerce','dialog',false,'Confirmar acción']];
(async()=>{try{
 const {createServer}=await import(pathToFileURL(path.join(finance,'node_modules/vite/dist/node/index.js')).href);
 server=await createServer({configFile:path.join(finance,'vite.config.js'),root:temp,cacheDir:path.join(temp,'.vite'),server:{host:'127.0.0.1',port:0,fs:{allow:[frontend,temp]}},resolve:{alias:{react:path.join(finance,'node_modules/react'),'react-dom':path.join(finance,'node_modules/react-dom')}}});
 await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
 await context.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();report.external.push(new URL(r.request().url()).origin);return r.abort();});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [app,screen,create,heading] of screens){
  await page.goto(origin+'/?app='+app+'&screen='+screen+(create?'&create=1':'')+(app==='ecommerce'&&screen==='products'&&create?'#/products/new':''));
  if(heading)await page.getByRole('heading',{name:heading,exact:true}).first().waitFor();else await page.locator('main h1').waitFor();
  await page.waitForFunction(()=>!(/Cargando|Sincronizando/).test(document.querySelector('main')?.textContent||''));await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.uonTheme),'dark');
  const findings=await page.evaluate(()=>{
   const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number);
   const luminance=c=>c.slice(0,3).map(x=>x/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   function background(el){while(el){const c=rgb(getComputedStyle(el).backgroundColor);if(c.length===3||c[3]>=.99)return c;el=el.parentElement;}return [10,11,13];}
   const bad=[],white=[];
   for(const el of document.querySelectorAll('main h1,main h2,main p,main label,main td,main th,main input:not([type=checkbox]):not([type=radio]),.brand,.status-badge,main button:not(:disabled),main li[aria-current=step],main a')){
    if(!el.getClientRects().length||el.closest('[hidden]')||el.disabled||!el.textContent.trim()&&!el.value&&!el.placeholder)continue;
    const style=getComputedStyle(el),bg=background(el),fg=rgb(style.color),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    if(ratio<4.5)bad.push({tag:el.tagName,class:el.className,text:el.textContent.trim().slice(0,45),color:style.color,bg,ratio});
   }
   for(const el of document.querySelectorAll('main form,main section,main input,main select,main textarea,main .panel,main .cat-surface')){
    const box=el.getBoundingClientRect(),bg=rgb(getComputedStyle(el).backgroundColor);
    if(box.width>80&&box.height>20&&bg.length>=3&&(bg.length===3||bg[3]===1)&&bg.slice(0,3).every(c=>c>220))white.push({tag:el.tagName,class:el.className});
   }
   return {bad,white};
  });
  const name=app+'-'+screen+(create?'-create':'');report.cases.push({name,...findings});
  await page.screenshot({path:path.join(output,name+'-desktop.png'),fullPage:true});
  assert.deepEqual(findings.bad,[],name+' contrast');assert.deepEqual(findings.white,[],name+' white surface');
  await page.setViewportSize({width:375,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' mobile overflow');
  await page.screenshot({path:path.join(output,name+'-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
 }
 await page.goto(origin+'/?app=ecommerce&screen=products');await page.getByRole('heading',{name:'Productos',exact:true}).waitFor();await page.getByRole('button',{name:/Tema de la interfaz/}).click();await page.getByRole('radio',{name:'Claro',exact:true}).check();assert.equal(await page.evaluate(()=>document.documentElement.dataset.uonTheme),'light');
 await page.getByRole('radio',{name:'Automático',exact:true}).check();await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.uonTheme==='light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.uonTheme),'light');await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.uonTheme==='dark');await page.getByRole('radio',{name:'Oscuro',exact:true}).check();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:/Tema de la interfaz/}).evaluate(e=>e===document.activeElement),true);await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.uonTheme),'dark');
 await page.getByRole('button',{name:'Uony en Ecommerce',exact:true}).click();await page.locator('.finance-assistant-panel').waitFor();assert.equal(await page.locator('.finance-assistant-panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(20, 23, 30)');await page.keyboard.press('Escape');
 await page.locator('mastererp-module-launcher').getByRole('button',{name:'Abrir aplicaciones'}).click();assert.equal(await page.locator('mastererp-module-launcher').locator('.panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(20, 23, 30)');
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 assert.deepEqual(errors,[]);assert.deepEqual(report.external,[]);report.status='passed';report.preferences='Light/dark/system, reload, keyboard Escape, assistant, launcher and print passed';
 }catch(error){report.status='failed';report.error=error.message;}
 finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();await server?.close();process.exit(report.status==='passed'?0:1);}
})();
