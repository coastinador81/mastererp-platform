// Local preview of Platform's canonical static Agent Center source and shared assets.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const at=process.argv.indexOf('--port'),port=at<0?5183:Number(process.argv[at+1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid preview port');
const files=new Map([
 ['/', ['frontend/modules/2.6-agent-center/agents-web/index.html','text/html; charset=utf-8']],
 ['/index.html',['frontend/modules/2.6-agent-center/agents-web/index.html','text/html; charset=utf-8']],
 ['/shared/module-launcher.mjs',['frontend/shared/module-launcher/module-launcher.mjs','text/javascript; charset=utf-8']],
 ['/shared/Inter-latin-variable.woff2',['frontend/modules/2.2-finance/src/assets/fonts/Inter-latin-variable.woff2','font/woff2']],
 ['/shared/Inter-OFL.txt',['frontend/modules/2.2-finance/public/fonts/Inter-OFL.txt','text/plain; charset=utf-8']],
]);
http.createServer(async(req,res)=>{
 const entry=files.get(new URL(req.url,'http://localhost').pathname);
 if(!entry){res.writeHead(404);res.end('Not found');return;}
 try{const bytes=await readFile(path.join(root,entry[0]));res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store'});res.end(bytes);}
 catch{res.writeHead(500);res.end('Preview asset unavailable');}
}).listen(port,'127.0.0.1',()=>console.log(`Agent Center preview: http://127.0.0.1:${port}/`));
