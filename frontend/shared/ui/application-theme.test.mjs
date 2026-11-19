import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTheme,validTheme} from './application-theme.mjs';
test('only the three documented preferences are accepted',()=>{for(const value of ['system','light','dark'])assert.equal(validTheme(value),true);for(const value of ['',null,'auto','DARK',{}])assert.equal(validTheme(value),false);});
test('explicit choice wins over the operating system',()=>{for(const os of [true,false]){assert.equal(resolveTheme('dark',os),'dark');assert.equal(resolveTheme('light',os),'light');}});
test('automatic theme follows the operating system',()=>{assert.equal(resolveTheme('system',true),'dark');assert.equal(resolveTheme('system',false),'light');});
test('initialization, persistence, storage and OS updates; no permission data',async()=>{
 const storage=new Map(),window=new EventTarget(),media=new EventTarget();media.matches=false;
 const saved={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage,matchMedia:globalThis.matchMedia};
 Object.assign(globalThis,{window,document:{documentElement:{dataset:{}}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},matchMedia:()=>media});
 try{
  const theme=await import('./application-theme.mjs?isolated');theme.initializeApplicationTheme();theme.initializeApplicationTheme();
  assert.equal(document.documentElement.dataset.uonTheme,'light');media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(document.documentElement.dataset.uonTheme,'dark');
  theme.setApplicationTheme('light');media.dispatchEvent(new Event('change'));assert.equal(document.documentElement.dataset.uonTheme,'light');assert.deepEqual([...storage],[['uonify.ui.theme','light']]);
  storage.set('uonify.ui.theme','dark');const event=new Event('storage');event.key='uonify.ui.theme';window.dispatchEvent(event);assert.equal(document.documentElement.dataset.uonTheme,'dark');
  assert.throws(()=>theme.setApplicationTheme('invalid'),TypeError);
  localStorage.getItem=()=>{throw Error('storage blocked');};localStorage.setItem=()=>{throw Error('storage blocked');};assert.equal(theme.themePreference(),'system');assert.doesNotThrow(()=>theme.setApplicationTheme('dark'));
 }finally{Object.assign(globalThis,saved);}
});
