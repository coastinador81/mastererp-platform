import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),at=args.indexOf('--infrastructure');
const infrastructure=at===-1?path.resolve(root,'../mastererp-infrastructure'):path.resolve(args[at+1]);
const source='frontend/shared/module-launcher/module-launcher.mjs';
const target=path.join(infrastructure,'modules/2.6-agent-center/agents-static/shared');
// Hash canonical LF bytes so Windows checkouts match Git/GitHub Actions.
const bytes=Buffer.from((await readFile(path.join(root,source),'utf8')).replace(/\r\n/g,'\n'),'utf8');
const manifest={sourceRepository:'eticayservicios/mastererp-platform',sourcePath:source,sha256:createHash('sha256').update(bytes).digest('hex'),generated:true};
if(args.includes('--check')){
 const copy=await readFile(path.join(target,'module-launcher.mjs'));
 const saved=JSON.parse(await readFile(path.join(target,'module-launcher-manifest.json'),'utf8'));
 if(!copy.equals(bytes)||saved.sha256!==manifest.sha256)throw new Error('Launcher copy differs: run scripts/sync_module_launcher.mjs');
 console.log('Shared launcher and generated Agent Center asset are identical.');
}else{
 await mkdir(target,{recursive:true});
 await writeFile(path.join(target,'module-launcher.mjs'),bytes);
 await writeFile(path.join(target,'module-launcher-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log('Generated Agent Center launcher asset: '+manifest.sha256);
}
