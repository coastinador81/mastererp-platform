/* Real DEV browser/service QA. No token/credential logging, traces or login screenshots. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright');
process.env.DEBUG='';process.env.PWDEBUG='';
const root=path.resolve(__dirname,'..'), output=path.resolve(root,'../mastererp-infrastructure/build/integrated-finance');
const evidence=path.join(root,'docs/finance-ui-evidence');fs.mkdirSync(evidence,{recursive:true});
const report={environment:'DEV us-west-1',run:'qa-parties-'+crypto.randomBytes(6).toString('hex'),results:[]};
let phase='initialize',browser,prepared=false,bundle,ids,currentToken=null;
function aws(args){return execFileSync('aws',args.concat(['--region','us-west-1','--profile','mastererp-admin']),{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function fixture(operation){
  const file=path.join(output,'browser-fixture-response.json');
  const payload=Buffer.from(JSON.stringify({action:'party_fixture',operation,run:report.run,identity_run:bundle.run})).toString('base64');
  const meta=JSON.parse(aws(['lambda','invoke','--function-name','mastererp-dev-database-migrator','--cli-binary-format','base64','--payload',payload,file]));
  const response=JSON.parse(fs.readFileSync(file,'utf8'));
  if(meta.FunctionError||response.status!=='succeeded')throw new Error('fixture_operation_failed');
  return response;
}
function pass(name,details={}){report.results.push({name,status:'passed',...details});save();}
function save(){fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(report,null,2));}
function check(value){if(!value)throw new Error('assertion_failed');}
async function login(actor,origin='https://app-dev.uonify.com',deep='/'){
 const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();
 currentToken=null;
 page.on('response',async response=>{if(response.url().includes('/oauth2/token')){try{currentToken=(await response.json()).access_token;}catch{}}});
 page.on('pageerror',()=>{report.browser_errors=(report.browser_errors||0)+1;});
 await page.goto(origin+'/#'+deep,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Acceder',exact:true}).click();
 await page.locator('input[name="username"]:visible').waitFor({timeout:30000});
 await page.locator('input[name="username"]:visible').fill(bundle.actors[actor].email);
 await page.locator('input[name="password"]:visible').fill(bundle.actors[actor].password);
 await page.locator('input[name="signInSubmitButton"]:visible').click();
 await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:45000});
 await page.waitForFunction(()=>!window.location.search,{timeout:10000});
 check(currentToken);return {context,page,origin};
}
async function select(page,tenant=ids.tenant_a,company=ids.company_a){
 await page.getByRole('combobox',{name:'Espacio',exact:true}).selectOption(tenant);
 await page.waitForFunction(id=>[...document.querySelector('select[aria-label="Empresa"]').options].some(o=>o.value===id),company,{timeout:20000});
 await page.getByRole('combobox',{name:'Empresa',exact:true}).selectOption(company);
}
async function api(page,method,capacity,body,extra={}){
 const token=currentToken;
 return page.evaluate(async input=>{
  const result=await fetch('https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com/v1/administration/'+input.capacity,{method:input.method,headers:{Authorization:'Bearer '+input.token,'X-MasterERP-Tenant-Id':input.tenant,'Content-Type':'application/json',...(input.key?{'Idempotency-Key':input.key}:{})},...(input.body?{body:JSON.stringify(input.body)}:{})});
  return {status:result.status,body:await result.json()};
 },{method,capacity,body,token,tenant:extra.tenant||ids.tenant_a,key:extra.key});
}
async function main(){
 bundle=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','mastererp/dev/qa/identity-validation','--query','SecretString','--output','text']));
 check(bundle.database_provisioned&&/^qa-identity-[0-9a-f]{12}$/.test(bundle.run));
 phase='prepare_fixtures';ids=fixture('prepare').ids;prepared=true;
 browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-extensions']});
 phase='login_admin';let {page,context,origin}=await login('admin_a');
 await select(page);pass('login_cognito_and_authorized_context');
 phase='api_authorization';const noToken=(await context.request.get('https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com/v1/administration/clientes?company_id='+ids.company_a)).status();
 check(noToken===401);pass('api_without_token_denied',{http:401});
 check((await api(page,'GET','clientes?company_id='+ids.company_b,null,{tenant:ids.tenant_b})).status===403);
 check((await api(page,'GET','clientes?company_id='+ids.company_b,null)).status===403);pass('foreign_tenant_and_company_denied',{http:403});
 check(new URL(page.url()).origin===origin);
 await page.locator('aside').getByRole('link',{name:'Finanzas',exact:true}).click();
 await page.getByRole('heading',{name:'Finanzas',exact:true}).waitFor();
 await page.screenshot({path:path.join(evidence,'finance-dashboard.png'),fullPage:true});
 pass('finance_inside_uonify_without_redirect');
 await page.locator('aside').getByRole('link',{name:'Clientes',exact:true}).click();
 await page.getByRole('heading',{name:'Clientes',exact:true}).waitFor();
 await page.getByRole('button',{name:'Crear cliente',exact:true}).click();
 const code=report.run+'-browser',name='Recorrido visual QA';
 await page.getByLabel('Código',{exact:true}).fill(code);await page.getByLabel('Nombre',{exact:true}).fill(name);
 const firstResponse=page.waitForResponse(r=>r.url().endsWith('/clientes')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Guardar',exact:true}).click();
 const first=await firstResponse,created=(await first.json()).data,id=created.id;
 check(first.status()===201);const key=first.request().headers()['idempotency-key'];
 await page.getByRole('heading',{name,exact:true}).waitFor();pass('customer_created_and_persisted',{http:201});
 phase='supplier_role';const roleResponse=page.waitForResponse(r=>r.url().endsWith('/proveedores')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Añadir rol proveedor',exact:true}).click();
 const role=await roleResponse;check(role.status()===201&&(await role.json()).data.id===id);
 await page.getByText('cliente, proveedor',{exact:true}).waitFor();pass('same_party_both_roles',{http:201});
 phase='edit_customer';await page.getByRole('button',{name:'Editar',exact:true}).click();
 await page.getByLabel('Nombre',{exact:true}).fill(name+' actualizado');
 const patchResponse=page.waitForResponse(r=>r.request().method()==='PATCH');await page.getByRole('button',{name:'Guardar',exact:true}).click();
 check((await patchResponse).status()===200);await page.getByRole('heading',{name:name+' actualizado',exact:true}).waitFor();pass('customer_update_persisted',{http:200});
 phase='supplier_detail';await page.locator('aside').getByRole('link',{name:'Proveedores',exact:true}).click();
 await page.getByRole('link',{name:'Ver detalle',exact:true}).click();
 await page.getByRole('heading',{name:name+' actualizado',exact:true}).waitFor();
 await page.screenshot({path:path.join(evidence,'party-detail.png'),fullPage:true});pass('supplier_lists_same_master');
 phase='optimistic_conflict';await page.getByRole('button',{name:'Editar',exact:true}).click();
 await page.getByText(/Versión /).waitFor();
 const version=Number((await page.getByText(/Versión /).innerText()).match(/Versión (\d+)/)[1]);
 const external=await api(page,'PATCH','proveedores/'+id,{company_id:ids.company_a,codigo:code,nombre:name+' concurrente',version});check(external.status===200);
 await page.getByLabel('Nombre',{exact:true}).fill(name+' obsoleto');
 const conflictResponse=page.waitForResponse(r=>r.request().method()==='PATCH');await page.getByRole('button',{name:'Guardar',exact:true}).click();
 check((await conflictResponse).status()===409);await page.getByRole('alert').getByText(/Conflicto/).waitFor();
 await page.screenshot({path:path.join(evidence,'version-conflict.png'),fullPage:true});pass('obsolete_version_rejected',{http:409});
 await page.getByRole('button',{name:'Recargar datos',exact:true}).click();await page.getByLabel('Nombre',{exact:true}).waitFor();
 await page.waitForFunction(value=>document.querySelector('input[name="nombre"]')?.value===value,name+' concurrente');
 const replay=await api(page,'POST','clientes',{company_id:ids.company_a,codigo:code,nombre:name},{key});check(replay.status===200&&replay.body.data.id===id&&replay.body.data.replayed);
 const different=await api(page,'POST','clientes',{company_id:ids.company_a,codigo:code,nombre:name+' diferente'},{key});check(different.status===409);pass('idempotency_replay_and_content_conflict',{replay_http:200,conflict_http:409});
 phase='pagination';for(let n=0;n<11;n++)check((await api(page,'POST','clientes',{company_id:ids.company_a,codigo:report.run+'-'+n,nombre:'Registro QA '+n},{key:'page-'+n})).status===201);
 await page.locator('aside').getByRole('link',{name:'Clientes',exact:true}).click();
 await page.getByRole('button',{name:'Siguiente',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Siguiente')?.disabled);
 check(await page.locator('tbody tr').count()===10);await page.getByRole('button',{name:'Siguiente',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===2);pass('cursor_pagination_real_records');
 phase='company_switch';await page.getByRole('combobox',{name:'Empresa',exact:true}).selectOption(ids.company_a2);
 await page.getByText('No hay clientes registrados en esta empresa.',{exact:true}).waitFor();check(!(await page.locator('main').innerText()).includes(code));pass('company_switch_clears_previous_data');
 await select(page);await page.locator('aside').getByRole('link',{name:'Clientes',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length>0);
 const deep=page.url();await page.reload();await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:45000});
 await page.getByRole('heading',{name:'Clientes',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length>0);
 check(page.url()===deep);pass('reload_recovers_session_and_validates_context');
 await page.locator('aside').getByRole('link',{name:'Finanzas',exact:true}).click();await page.goBack();await page.getByRole('heading',{name:'Clientes',exact:true}).waitFor();await page.goForward();await page.getByRole('heading',{name:'Finanzas',exact:true}).waitFor();pass('back_forward_navigation');
 phase='denied_write';fixture('deny');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.locator('aside').getByRole('link',{name:'Clientes',exact:true}).click();await page.getByRole('heading',{name:'Clientes',exact:true}).waitFor();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Crear cliente'));
 check((await api(page,'POST','clientes',{company_id:ids.company_a,codigo:report.run+'-denied',nombre:'Denied QA'},{key:'denied'})).status===403);pass('revoked_write_hidden_and_api_denied',{http:403});
 phase='module_disabled';fixture('module_disabled');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('aside a')).some(a=>a.textContent==='Finanzas'));
 check((await api(page,'GET','clientes?company_id='+ids.company_a,null)).status===403);pass('disabled_module_hidden_and_api_denied',{http:403});
 fixture('restore');await page.reload();await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:45000});await select(page);
 phase='inactive_membership';fixture('membership_inactive');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('alert').filter({hasText:'Acceso denegado a este espacio.'}).waitFor();
 check((await api(page,'GET','clientes?company_id='+ids.company_a,null)).status===403);check(await page.getByRole('combobox',{name:'Empresa',exact:true}).inputValue()==='');pass('inactive_membership_clears_context',{http:403});
 fixture('restore');await page.reload();await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:45000});await select(page);
 phase='inactive_tenant';fixture('tenant_inactive');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('alert').filter({hasText:'Acceso denegado a este espacio.'}).waitFor();check((await api(page,'GET','clientes?company_id='+ids.company_a,null)).status===403);pass('inactive_tenant_denied',{http:403});
 fixture('restore');await page.reload();await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:45000});await select(page);
 phase='mobile';await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Abrir menú',exact:true}).click();await page.locator('aside').getByRole('link',{name:'Finanzas',exact:true}).click();await page.getByRole('heading',{name:'Finanzas',exact:true}).waitFor();
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:path.join(evidence,'finance-mobile.png'),fullPage:true});pass('responsive_mobile');
 phase='logout';await page.getByRole('button',{name:'Salir',exact:true}).click();await page.getByRole('button',{name:'Acceder',exact:true}).waitFor({timeout:30000});
 check(await page.evaluate(()=>!sessionStorage.getItem('mastererp.dev.selection')&&!sessionStorage.getItem('mastererp.dev.returning')));check(!(await page.locator('main').innerText()).includes(code));pass('logout_clears_context');await context.close();
 phase='member';({page,context}=await login('member_a','https://app-dev.uonify.com','/modulos/finanzas/administracion/clientes'));
 await page.getByRole('combobox',{name:'Espacio',exact:true}).selectOption(ids.tenant_a);await page.getByRole('alert').filter({hasText:'No tienes acceso a Finanzas'}).waitFor();check(await page.locator('aside').getByRole('link',{name:'Finanzas',exact:true}).count()===0);pass('member_without_permissions_denied');await context.close();
 phase='standalone';({page,context}=await login('admin_a','https://finanzas-dev.uonify.com','/modulos/finanzas/administracion/proveedores'));
 await select(page);await page.getByRole('heading',{name:'Proveedores',exact:true}).waitFor();await page.getByRole('link',{name:'Ver detalle',exact:true}).waitFor();check(new URL(page.url()).origin==='https://finanzas-dev.uonify.com');pass('standalone_same_screens_real_api');
 phase='expiry';await page.clock.install();await page.clock.fastForward(16*60*1000);await page.getByRole('button',{name:'Acceder',exact:true}).waitFor();
 check(!(await page.locator('main').innerText()).includes(code));pass('session_expiry_ui_clock_controlled');await context.close();
 report.audit=fixture('inspect').valid_party_audit_events;check(report.audit>0);report.status='passed';
}
(async()=>{try{await main();}catch{report.status='failed';report.failed_phase=phase;}finally{if(browser)await browser.close();if(prepared){try{fixture('cleanup');report.cleanup='passed';}catch{report.cleanup='failed';report.status='failed';}}save();console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;}})();
