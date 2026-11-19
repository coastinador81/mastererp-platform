import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig(({command,mode})=>({
 resolve:{dedupe:['react','react-dom']},
 server:{
  fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]},
  ...(command==='serve'&&mode==='dev'?{proxy:{
   '/__identity':{
    target:'https://ebn01q74hh.execute-api.us-west-1.amazonaws.com',
    changeOrigin:true,
    rewrite:path=>path.replace(/^\/__identity/,'')
   }
  }}:{})
 }
}));
