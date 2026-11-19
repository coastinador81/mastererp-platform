const key='uonify.ui.theme';
export const validTheme=value=>['system','light','dark'].includes(value);
export const resolveTheme=(preference,systemDark)=>preference==='dark'||preference==='system'&&systemDark?'dark':'light';
let initialized=false;
export function themePreference(){
 try{const value=localStorage.getItem(key);return validTheme(value)?value:'system';}catch{return 'system';}
}
function apply(preference){
 const root=document.documentElement;
 root.dataset.uonThemeScope='administration';
 root.dataset.uonThemePreference=preference;
 root.dataset.uonTheme=resolveTheme(preference,matchMedia('(prefers-color-scheme: dark)').matches);
 window.dispatchEvent(new Event('uonify-theme-change'));
}
export function setApplicationTheme(preference){
 if(!validTheme(preference))throw new TypeError('Invalid theme');
 try{localStorage.setItem(key,preference);}catch{/* A storage restriction never prevents using the theme. */}
 apply(preference);
}
export function initializeApplicationTheme(){
 if(initialized)return;initialized=true;apply(themePreference());
 const media=matchMedia('(prefers-color-scheme: dark)');
 media.addEventListener('change',()=>{if(document.documentElement.dataset.uonThemePreference==='system')apply('system');});
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(themePreference());});
}
