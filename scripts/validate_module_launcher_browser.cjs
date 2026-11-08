// Public-entry UI checks only. No login, credentials, business data or backend calls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),live=process.argv.includes('--live');
const at=process.argv.indexOf('--output');
const output=at<0?path.join(root,'frontend/modules/2.2-finance/node_modules/.cache/module-launcher'):path.resolve(process.argv[at+1]);
const apps=[
 {id:'inventory',name:'Inventario',origin:'https://inventario-dev.uonify.com',folder:path.join(root,'frontend/modules/2.1-inventory/dist'),index:'index.html'},
 {id:'finance',name:'Finanzas',origin:'https://finanzas-dev.uonify.com',folder:path.join(root,'frontend/modules/2.2-finance/dist'),index:'index.html'},
 {id:'ecommerce',name:'Ecommerce',origin:'https://ecom-dev.uonify.com',folder:path.join(root,'frontend/modules/2.3-ecommerce/dist'),index:'index.html'},
 {id:'agents',name:'Centro de Agentes',origin:'https://agentes-dev.uonify.com',folder:path.resolve(root,'../mastererp-infrastructure/modules/2.6-agent-center/agents-static'),index:'landing.html'},
];
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.json':'application/json'};
async function serve(app){
 const server=http.createServer((req,res)=>{
  let target=path.resolve(app.folder,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!target.startsWith(app.folder+path.sep)&&target!==app.folder){res.writeHead(403);res.end();return;}
  if(target===app.folder||!fs.existsSync(target)&&!path.extname(target))target=path.join(app.folder,app.index);
  if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 app.local='http://127.0.0.1:'+server.address().port;
 return server;
}
(async()=>{
 const report={scope:live?'Public HTTPS entry navigation only; no SSO or authorized business operations':'Local compiled apps/static landing; external app redirects replaced in this test only; no DEV persistence',results:[]};
 const servers=[];let browser;
 fs.mkdirSync(output,{recursive:true});
 const pass=(app,scenario)=>report.results.push({app,scenario,result:'passed'});
 try{
  if(!live)for(const app of apps)servers.push(await serve(app));
  browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const errors=[];
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   const app=apps.find(app=>url.origin===app.origin);
   if(app){
    if(live)return route.continue();
    if(request.isNavigationRequest())return route.fulfill({status:302,headers:{location:app.local+url.pathname+url.search+url.hash}});
   }
   if(!live&&apps.some(app=>url.origin===app.local))return route.continue();
   if(['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.continue();
   return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const app of apps){
   await page.setViewportSize({width:1440,height:1000});
   await page.goto(live?app.origin:app.local,{waitUntil:'domcontentloaded'});
   const host=page.locator('mastererp-module-launcher'),trigger=page.getByRole('button',{name:'Abrir módulos',exact:true});
   await trigger.click();
   const panel=page.getByRole('region',{name:'Módulos de MasterERP'});
   assert.equal(await panel.locator('.tile').count(),12);
   assert.equal(await panel.locator('[aria-current="true"]').innerText(),app.name+'\nEstás aquí');
   assert.equal(await panel.locator('[aria-disabled="true"]').count(),12-apps.length-1);
   const links=await panel.getByRole('link').evaluateAll(nodes=>nodes.map(node=>node.href).sort());
   assert.deepEqual(links,[...apps.filter(other=>other!==app).map(other=>other.origin+'/'),'https://dev.uonify.com/'].sort());
   pass(app.id,'catalogue_current_app_available_links_pending');
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.join(output,app.id+'-desktop.png'),fullPage:true});
   await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   assert.equal(await host.evaluate(node=>node.shadowRoot.activeElement?.className),'trigger');
   await trigger.press('ArrowDown');assert.equal(await host.evaluate(node=>node.shadowRoot.activeElement?.tagName),'A');
   await page.keyboard.press('Escape');await trigger.click();await page.mouse.click(12,12);
   assert.equal(await trigger.getAttribute('aria-expanded'),'false');pass(app.id,'keyboard_focus_escape_outside_click');
   await page.setViewportSize({width:390,height:844});await trigger.click();
   await panel.getByText('Punto de venta',{exact:true}).scrollIntoViewIfNeeded();
   const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(output,app.id+'-mobile.png'),fullPage:true});pass(app.id,'mobile_bounds_scroll');
   await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto(live?apps[0].origin:apps[0].local);
  for(const destination of [...apps.slice(1),apps[0]]){
   await page.getByRole('button',{name:'Abrir módulos',exact:true}).click();
   await page.getByRole('link',{name:destination.name+' Abrir aplicación',exact:true}).click();
   await page.waitForURL(url=>url.origin===(live?destination.origin:destination.local));
   await page.getByRole('button',{name:'Abrir módulos',exact:true}).waitFor();
  }
  pass('cross-app','all_available_apps_same_tab');
  assert.deepEqual(errors,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;throw error;}
 finally{
  fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
  if(browser)await browser.close();for(const server of servers)await new Promise(resolve=>server.close(resolve));
  console.log(JSON.stringify({status:report.status,checks:report.results.length,scope:report.scope,output}));
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
