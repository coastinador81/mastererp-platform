/* Read-only published-shell checks. Existing QA identity only; no fixture provisioning. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve(process.argv[2]||'.review/published-theme');fs.mkdirSync(output,{recursive:true});
const report={scope:'Published DEV frontend, actual Cognito QA login; no business writes',sites:[]};
let browser,page,phase='initialize';
function credentials(){return JSON.parse(execFileSync('aws',['secretsmanager','get-secret-value','--secret-id','mastererp/dev/qa/identity-validation','--query','SecretString','--output','text','--profile','mastererp-admin','--region','us-west-1'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40000})).actors.admin_a;}
const check=(ok,label)=>{if(!ok)throw Error(label);};
(async()=>{try{
 browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
 for(const [app,origin] of [['finance','https://finanzas-dev.uonify.com'],['ecommerce','https://ecom-dev.uonify.com']]){
  page=await context.newPage();page.setDefaultTimeout(30000);phase=app+'_login';
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean([...document.querySelectorAll('input[name=password]')].some(e=>e.offsetWidth))||[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Salir'||e.textContent.trim()==='Acceder'&&!e.disabled),null,{timeout:60000});
  if(new URL(page.url()).origin===origin&&await page.getByRole('button',{name:'Acceder',exact:true}).count())await page.getByRole('button',{name:'Acceder',exact:true}).click();
  if(!await page.getByRole('button',{name:'Salir',exact:true}).count()){
   const actor=credentials();await page.locator('input[name=username]:visible').fill(actor.email);await page.locator('input[name=password]:visible').fill(actor.password);await page.locator('input[name=signInSubmitButton]:visible').click();
  }
  await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:60000});
  phase=app+'_dark';check(new URL(page.url()).origin===origin,'wrong_origin');await page.waitForFunction(()=>document.documentElement.dataset.uonTheme==='dark');
  const choose=async name=>{const button=page.getByRole('button',{name:/Tema de la interfaz:/});if(await button.getAttribute('aria-expanded')!=='true')await button.click();await page.getByRole('radio',{name,exact:true}).check();await page.keyboard.press('Escape');};
  await choose('Oscuro');await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Salir',exact:true}).waitFor({timeout:60000});
  check(await page.evaluate(()=>document.documentElement.dataset.uonTheme)==='dark','dark_not_restored');
  check(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(10, 11, 13)','dark_canvas');
  await page.screenshot({path:path.join(output,app+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:850});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile_overflow');await page.screenshot({path:path.join(output,app+'-mobile.png'),fullPage:true});
  phase=app+'_light';await choose('Claro');check(await page.evaluate(()=>document.documentElement.dataset.uonTheme)==='light','light_not_applied');
  phase=app+'_system';await choose('Automático');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.uonTheme==='light');await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.uonTheme==='dark');
  await choose('Oscuro');report.sites.push({origin,status:'passed',cognito_login:true,dark_reload:true,light:true,automatic_system_changes:true,mobile_375:true});await page.close();
 }
 report.status='passed';
 }catch(error){report.status='failed';report.phase=phase;if(page){const u=new URL(page.url());report.location={origin:u.origin,path:u.pathname};}report.error='Published theme check did not complete';}
 finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();process.exit(report.status==='passed'?0:1);}
})();
