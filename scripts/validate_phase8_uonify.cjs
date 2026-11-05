/* Real DEV browser check for injected Tumandaito modules. No screenshots or token logs. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright-core');
const report={environment:'DEV us-west-1',read_only:true,results:[]};
let browser,page,prepared=false,bundle,tenant,company,nonce=crypto.randomUUID(),phase='initialize';
function aws(args){return execFileSync('aws',args.concat(['--region','us-west-1','--profile','andrea_madriz_mastererp']),{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function invoke(action,extra={}){
  const file='/tmp/mastererp-phase8-browser-response.json';
  const payload=Buffer.from(JSON.stringify({action,...extra})).toString('base64');
  const metadata=JSON.parse(aws(['lambda','invoke','--function-name','mastererp-dev-database-migrator','--cli-binary-format','base64','--payload',payload,file]));
  const response=JSON.parse(fs.readFileSync(file,'utf8'));
  if(metadata.FunctionError||response.status!=='succeeded')throw new Error(action+'_failed');
  return response;
}
function pass(name,extra={}){report.results.push({case:name,result:'passed',...extra});}
function check(value){if(!value)throw new Error('assertion_failed');}
async function main(){
  check(JSON.parse(aws(['sts','get-caller-identity','--output','json'])).Account==='277352717693');
  bundle=JSON.parse(aws(['secretsmanager','get-secret-value','--secret-id','mastererp/dev/qa/identity-validation','--query','SecretString','--output','text']));
  const scope=invoke('inspect_business_tenant',{name:'Tumandaito'}).tenants[0];tenant=scope.id;company=scope.companies[0].id;
  try{invoke('qa_phase8_membership',{run:bundle.run,operation:'prepare',nonce});}
  catch{invoke('qa_phase8_membership',{run:bundle.run,operation:'cleanup',nonce});invoke('qa_phase8_membership',{run:bundle.run,operation:'prepare',nonce});}
  prepared=true;pass('temporary_membership_prepared');
  browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--disable-extensions','--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:960}});page=await context.newPage();
  const failures=[];page.on('pageerror',error=>failures.push(error.name));
  page.on('response',response=>{const pathname=new URL(response.url()).pathname;if(pathname==='/v1/products'||pathname.endsWith('/orders'))report.http={...(report.http||{}),[pathname]:response.status()};});
  phase='open';await page.goto('https://app-dev.uonify.com/',{waitUntil:'domcontentloaded'});
  phase='login_redirect';await page.getByRole('button',{name:'Acceder',exact:true}).click();
  phase='login_form';
  await page.locator('input[name="username"]:visible').waitFor({timeout:30000});
  await page.locator('input[name="username"]:visible').fill(bundle.actors.admin_a.email);
  await page.locator('input[name="password"]:visible').fill(bundle.actors.admin_a.password);
  phase='login_submit';await page.locator('input[name="signInSubmitButton"]:visible').click();
  phase='login_callback';
  await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:45000});
  pass('cognito_login');
  phase='tenant';await page.getByRole('combobox',{name:'Espacio',exact:true}).selectOption(tenant);
  await page.waitForFunction(id=>[...document.querySelector('select[aria-label="Empresa"]').options].some(option=>option.value===id),company,{timeout:20000});
  await page.getByRole('combobox',{name:'Empresa',exact:true}).selectOption(company);
  pass('tumandaito_context');
  phase='products_link';report.navigation=await page.locator('aside a').allTextContents();await page.locator('aside').getByRole('link',{name:'Productos',exact:true}).click();
  phase='products_heading';
  await page.getByRole('heading',{name:'Productos',exact:true}).waitFor();
  phase='products_data';
  await page.waitForFunction(()=>document.querySelectorAll('.products-module .card').length===27,{timeout:30000});
  check(await page.locator('.products-module .card').count()===27);pass('products_injected',{count:27});
  phase='orders_link';await page.locator('aside').getByRole('link',{name:'Pedidos',exact:true}).click();
  phase='orders_heading';
  await page.getByRole('heading',{name:'Pedidos',exact:true}).waitFor();
  phase='orders_data';
  await page.waitForFunction(()=>document.querySelectorAll('.orders-module .card').length===9,{timeout:30000});
  check(await page.locator('.orders-module .card').count()===9);pass('orders_injected',{count:9});
  check(new URL(page.url()).origin==='https://app-dev.uonify.com');check(failures.length===0);pass('single_shell_without_browser_errors');
  await context.close();report.status='passed';
}
(async()=>{try{await main();}catch(error){report.status='failed';report.failed_phase=phase;report.error_type=error.name;try{const current=new URL(page?.url()||'https://invalid/');report.failed_origin_path=current.origin+current.pathname;report.visible_alerts=await page.locator('[role=alert]').allTextContents();}catch{}}
finally{if(browser)await browser.close();if(prepared){try{invoke('qa_phase8_membership',{run:bundle.run,operation:'cleanup',nonce});pass('temporary_membership_removed');}catch{report.status='failed';report.cleanup='failed';}}
fs.writeFileSync('/tmp/mastererp-phase8-uonify.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;}})();
