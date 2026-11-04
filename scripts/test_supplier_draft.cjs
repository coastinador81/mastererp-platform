/* Local browser tests against the built Finance bundle. No backend fixtures or credentials. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.MASTERERP_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../frontend/modules/2.2-finance/dist');
const check=(value,message)=>{if(!value)throw Error(message);};
(async()=>{
  let browser;const results=[],remote=[];
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime});fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    browser=await chromium.launch({executablePath:process.env.MASTERERP_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,timeout:15000});
    const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();page.setDefaultTimeout(10000);
    await context.addInitScript(()=>sessionStorage.setItem('mastererp.dev.returning','true'));
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){remote.push(new URL(route.request().url()).pathname);route.abort();}else route.continue();});
    await page.goto(origin+'/?vista=proveedores');
    await page.getByRole('heading',{name:'Ficha de proveedor',exact:true}).waitFor();results.push('public supplier form without login');
    check(await page.getByRole('navigation',{name:'Administración',exact:true}).getByRole('link',{name:'Proveedores',exact:true}).getAttribute('href')==='/?vista=proveedores','menu destination');results.push('supplier menu opens the development form');
    await page.locator('[name="codigo"]').fill('QA-SUPPLIER-UI');await page.locator('[name="nombre"]').fill('Proveedor QA <script>');
    for(const [key,value] of Object.entries({nombre_comercial:'Proveedor de prueba',pais_fiscal:'ve',tipo_identificacion:'RIF',numero_identificacion:'QA-IDENT-01',direccion:'Calle de pruebas 1',direccion_complementaria:'Oficina 2',ciudad:'Ciudad QA',municipio:'Municipio QA',region:'Región QA',codigo_postal:'1000',pais:'ve',email:'qa@example.invalid',telefono:'+58 000 0000000',telefono_alterno:'+58 000 0000001',sitio_web:'https://example.invalid',moneda:'usd',plazo_pago_dias:'30',descuento_pronto_pago:'3',observaciones:'Datos sintéticos <b>sin HTML</b>'}))await page.locator('[name="'+key+'"]').fill(value);
    await page.locator('[name="tipo_persona"]').selectOption('juridica');await page.locator('[name="condicion_pago"]').selectOption('credito');await page.locator('[name="medio_pago"]').selectOption('transferencia');
    check(await page.locator('[name="pais_fiscal"]').inputValue()==='VE','country uppercase');
    check(await page.locator('[name="moneda"]').inputValue()==='USD','currency uppercase');results.push('fiscal/address/contact/commercial fields populated');
    await page.getByRole('button',{name:'Revisar ficha'}).click();await page.getByRole('alert').filter({hasText:'Indica juntos'}).waitFor();results.push('incomplete early-payment terms rejected');
    await page.locator('[name="plazo_pronto_pago_dias"]').fill('5');
    await page.getByRole('button',{name:'Añadir contacto',exact:true}).click();
    await page.locator('[name="contactos.0.nombre"]').fill('Contacto QA uno');await page.locator('[name="contactos.1.nombre"]').fill('Contacto QA dos');
    await page.locator('[name="contactos.1.cargo"]').fill('Compras');await page.locator('[name="contactos.1.email"]').fill('invalid');
    await page.getByLabel('Contacto principal',{exact:true}).nth(1).check();
    await page.getByRole('button',{name:'Revisar ficha'}).click();check(await page.locator('[name="contactos.1.email"]').evaluate(el=>!el.checkValidity()),'invalid email accepted');results.push('invalid contact email rejected');
    await page.locator('[name="contactos.1.email"]').fill('contacto@example.invalid');
    await page.getByRole('button',{name:'Revisar ficha'}).click();await page.getByRole('heading',{name:'Revisar proveedor',exact:true}).waitFor();
    await page.getByRole('heading',{name:'Contacto 2 · Principal',exact:true}).waitFor();await page.getByText('Proveedor QA <script>',{exact:true}).waitFor();
    check(await page.locator('main script').count()===0,'unsafe markup');results.push('review includes second principal contact and escaped values');
    await page.getByRole('button',{name:'Volver a editar'}).click();check(await page.locator('[name="codigo"]').inputValue()==='QA-SUPPLIER-UI','edit loses draft');
    await page.getByRole('button',{name:'Quitar contacto 1',exact:true}).click();check(await page.getByLabel('Contacto principal',{exact:true}).isChecked(),'principal changed after remove');results.push('editing preserves draft and removing contact preserves principal');
    await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');results.push('mobile without horizontal overflow');
    await page.reload();await page.getByRole('heading',{name:'Ficha de proveedor',exact:true}).waitFor();check(await page.locator('[name="codigo"]').inputValue()==='','unexpected persistence');
    check(await page.evaluate(()=>localStorage.length)===0,'local storage used');results.push('reload clears draft; no localStorage');
    check(remote.length===0,'external request attempted');results.push('no API, OAuth or external requests despite returning-session hint');
    console.log(JSON.stringify({status:'passed',checks:results.length,results},null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}finally{
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
