/* Local browser checks of the real Parties component. Fixtures exist only in this harness. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend'),finance=path.join(frontend,'modules/2.2-finance');
const output=path.join(finance,'node_modules/.cache/supplier-row-ux');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'mastererp-supplier-row-'));
const report={scope:'local browser; synthetic fixtures; no backend/AWS requests',results:[]};
let server,browser;
const source=file=>'/@fs/'+file.replaceAll('\\','/');
const pass=name=>report.results.push({name,status:'passed'});
const first='00009901-0000-0000-0000-000000000001',second='00009901-0000-0000-0000-000000000002';
const parties=path.join(finance,'2.2.1-administration/screens/parties/Parties.jsx');
fs.writeFileSync(path.join(temporary,'index.html'),'<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/harness.jsx"></script></html>');
fs.writeFileSync(path.join(temporary,'harness.jsx'),`
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import Parties from ${JSON.stringify(source(parties))};
import {financeUrl,workspacePath} from ${JSON.stringify(source(path.join(frontend,'app-shell/src/financeRoutes.mjs')))};
import ${JSON.stringify(source(path.join(frontend,'app-shell/src/shell.css')))};
window.__requests=[];window.__navigations=[];
const records=[${JSON.stringify(first)},${JSON.stringify(second)},'00009901-0000-0000-0000-000000000003'].map((id,index)=>({id,codigo:'PROV-00'+(index+1),nombre:'Proveedor QA '+(index+1),roles:['proveedor'],version:1,profile_version:1,catalog_version:1,datos_generales:{numero_identificacion:'DEMO-'+index,email:'qa'+index+'@example.invalid',telefono:'000-000-0000'},contactos:[],condiciones:{}}));
const readOnly=new URLSearchParams(location.search).has('readonly');
function Harness(){
 const [route,setRoute]=useState(()=>workspacePath(location,true));
 const capacity=route.includes('/clientes')?'clientes':'proveedores';
 useEffect(()=>{const change=()=>setRoute(workspacePath(location,true));window.addEventListener('popstate',change);window.addEventListener('hashchange',change);return()=>{window.removeEventListener('popstate',change);window.removeEventListener('hashchange',change);};},[]);
 const navigate=destination=>{window.__navigations.push(destination);history.pushState(null,'',financeUrl(destination)||'#'+destination);setRoute(destination);};
 const workspace={tenant:'00009902-0000-0000-0000-000000000001',company:'00009903-0000-0000-0000-000000000001',context:{permissions:readOnly?['administration.parties.read']:['administration.parties.read','administration.parties.write']},denied:()=>{throw Error('Unexpected denial');},request:async(url,options)=>{
 window.__requests.push({url,headers:options.headers});const query=new URL(url),id=query.pathname.split('/').at(-1);
 const items=records.map(row=>capacity==='clientes'?{...row,nombre:row.nombre.replace('Proveedor','Cliente'),roles:['cliente']}:row);
 return {data:items.find(row=>row.id===id)||{items:query.searchParams.has('after')?[items[2]]:items.slice(0,2),next_cursor:query.searchParams.has('after')?null:${JSON.stringify(second)}}};}};
 return <main className="integrated-content"><Parties key={route+capacity} {...{workspace,capacity,navigate}} path={route}/></main>;
}createRoot(document.getElementById('root')).render(<Harness/>);
`);
(async()=>{try{
 const {createServer}=await import(pathToFileURL(path.join(finance,'node_modules/vite/dist/node/index.js')).href);
 server=await createServer({configFile:path.join(finance,'vite.config.js'),root:temporary,cacheDir:path.join(temporary,'.vite'),
  server:{host:'127.0.0.1',port:0,fs:{allow:[frontend,temporary]}},
  resolve:{alias:{react:path.join(finance,'node_modules/react'),'react-dom':path.join(finance,'node_modules/react-dom')}}});
 await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),external=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const listing=async()=>{await page.goto(origin+'/?vista=proveedores');await page.getByRole('link',{name:'Proveedor QA 1',exact:true}).waitFor();};
 const detail=async(target=page)=>target.getByRole('heading',{name:'Proveedor QA 1',exact:true}).waitFor();
 await listing();assert.deepEqual(await page.locator('thead th').allTextContents(),['Código','Nombre','Roles','Identificación fiscal','Correo','Teléfono']);assert.equal(await page.getByRole('link',{name:'Ver detalle',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Crear proveedor',exact:true}).count(),1);pass('supplier_columns_and_create_button_preserved_without_action_column');
 await page.locator('tbody tr').first().locator('td').first().click();await detail();assert.equal(new URL(page.url()).searchParams.get('id'),first);pass('row_cell_click_uses_existing_navigation');
 await listing();const email=page.locator('tbody tr').first().locator('td').nth(4),box=await email.boundingBox();await email.click({position:{x:box.width-5,y:box.height/2}});await detail();pass('row_whitespace_opens_supplier');
 await listing();const link=page.getByRole('link',{name:'Proveedor QA 1',exact:true});await page.getByRole('button',{name:'Crear proveedor',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await link.evaluate(node=>node===document.activeElement),true);
 assert.equal(await link.evaluate(node=>getComputedStyle(node.closest('tr').cells[0]).backgroundColor),'rgb(234, 243, 255)');await page.keyboard.press('Enter');await detail();assert.equal(await page.evaluate(()=>window.__navigations.length),1);pass('keyboard_tab_focus_and_enter_open_once');
 await listing();const before=page.url(),popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'Proveedor QA 1',exact:true}).click({modifiers:['Control']});const popup=await popupPromise;await detail(popup);assert.equal(page.url(),before);assert.equal(await page.evaluate(()=>window.__navigations.length),0);await popup.close();pass('native_name_link_opens_new_tab_without_navigating_original');
 const bounds=await page.locator('tbody tr').first().locator('td').nth(4).evaluate(cell=>{const range=document.createRange();range.selectNodeContents(cell);const box=range.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};});
 await page.mouse.move(bounds.x+1,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width-1,bounds.y+bounds.height/2,{steps:12});await page.mouse.up();assert.ok(await page.evaluate(()=>window.getSelection().toString().length>0));assert.equal(page.url(),before);assert.equal(await page.evaluate(()=>window.__navigations.length),0);pass('real_text_selection_does_not_navigate');
 await page.locator('tbody tr').first().dispatchEvent('click',{button:0});assert.equal(await page.evaluate(()=>window.__navigations.length),0);await page.evaluate(()=>window.getSelection().removeAllRanges());pass('selected_text_guard_rejects_accidental_row_click');
 await page.locator('tbody tr').first().locator('td').first().click({modifiers:['Control']});assert.equal(page.url(),before);pass('modified_row_click_does_not_hijack_browser_gestures');
 await page.locator('tbody tr').first().evaluate(row=>{const cell=row.lastElementChild;const button=document.createElement('button');button.textContent='Control QA';button.onclick=()=>window.__controlClicked=true;cell.append(button);const label=document.createElement('label');label.textContent='Seleccionar proveedor QA';const checkbox=document.createElement('input');checkbox.type='checkbox';label.append(checkbox);cell.append(label);const editable=document.createElement('span');editable.contentEditable='true';editable.setAttribute('role','textbox');editable.setAttribute('aria-label','Nota QA');editable.textContent='Nota';cell.append(editable);});
 await page.getByRole('button',{name:'Control QA',exact:true}).click();assert.equal(await page.evaluate(()=>window.__controlClicked),true);await page.getByText('Seleccionar proveedor QA',{exact:true}).click();assert.equal(await page.getByRole('checkbox').isChecked(),true);await page.getByRole('textbox',{name:'Nota QA'}).fill('Nota editada');assert.equal(page.url(),before);assert.equal(await page.evaluate(()=>window.__navigations.length),0);pass('buttons_labels_checkboxes_and_editable_controls_keep_their_own_behavior');
 await listing();await page.getByRole('link',{name:'Proveedor QA 1',exact:true}).blur();await page.locator('tbody tr').first().hover();assert.equal(await page.locator('tbody tr').first().locator('td').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(243, 247, 252)');pass('subtle_row_hover_uses_existing_palette');
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.getByRole('link',{name:'Proveedor QA 3',exact:true}).waitFor();await page.getByRole('button',{name:'Anterior',exact:true}).click();await page.getByRole('link',{name:'Proveedor QA 1',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__requests.every(request=>request.headers['X-MasterERP-Tenant-Id']==='00009902-0000-0000-0000-000000000001'&&new URL(request.url).searchParams.get('company_id')==='00009903-0000-0000-0000-000000000001')),true);pass('pagination_and_tenant_company_context_unchanged');
 await page.goto(origin+'/?vista=proveedores&readonly=1');await page.getByRole('link',{name:'Proveedor QA 1',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Crear proveedor',exact:true}).count(),0);await page.locator('tbody tr').first().locator('td').first().click();await detail();pass('read_only_permissions_keep_detail_access_and_hide_create');
 await page.goto(origin+'/?vista=clientes');await page.getByRole('link',{name:'Ver detalle',exact:true}).first().waitFor();assert.deepEqual(await page.locator('thead th').allTextContents(),['Código','Nombre','Roles','Acción']);assert.equal(await page.locator('.supplier-row').count(),0);const clientUrl=page.url();await page.locator('tbody tr').first().locator('td').first().click();assert.equal(page.url(),clientUrl);pass('customers_keep_existing_columns_link_and_non_clickable_rows');
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobileContext.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const mobile=await mobileContext.newPage();await mobile.goto(origin+'/?vista=proveedores');await mobile.getByRole('link',{name:'Proveedor QA 1',exact:true}).waitFor();assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobile.screenshot({path:path.join(output,'mobile.png'),fullPage:true});await mobile.locator('tbody tr').first().locator('td').first().tap();await detail(mobile);pass('mobile_layout_has_no_page_overflow_and_row_tap_opens_detail');await mobileContext.close();
 assert.equal(external.length,0);report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
 finally{
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(browser)await browser.close();if(server)await server.close();
  const resolved=path.resolve(temporary);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('mastererp-supplier-row-'));fs.rmSync(resolved,{recursive:true,force:true});
 }
})();
