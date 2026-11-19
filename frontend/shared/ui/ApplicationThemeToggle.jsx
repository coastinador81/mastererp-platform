import React,{useEffect,useRef,useState} from 'react';
import {setApplicationTheme,themePreference} from './application-theme.mjs';
import './application-theme-toggle.css';
const choices=[['system','Automático'],['light','Claro'],['dark','Oscuro']];
export default function ApplicationThemeToggle(){
 const [preference,setPreference]=useState(themePreference),[open,setOpen]=useState(false);
 const container=useRef(null),trigger=useRef(null);
 useEffect(()=>{const change=()=>setPreference(document.documentElement.dataset.uonThemePreference||'system');window.addEventListener('uonify-theme-change',change);return()=>window.removeEventListener('uonify-theme-change',change);},[]);
 useEffect(()=>{
  if(!open)return;
  const outside=e=>{if(!container.current?.contains(e.target))setOpen(false);};
  const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape,true);};
 },[open]);
 return <div className="application-theme-picker" ref={container}>
  <button type="button" ref={trigger} className="secondary application-theme-trigger" aria-label={'Tema de la interfaz: '+choices.find(([value])=>value===preference)[1]} title="Cambiar tema" aria-expanded={open} aria-controls="application-theme-options" onClick={()=>setOpen(!open)}>
   <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{preference==='dark'?<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5Z"/>:preference==='light'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>}</svg>
  </button>
  {open&&<fieldset id="application-theme-options" className="application-theme-options"><legend>Tema de la interfaz</legend>{choices.map(([value,label])=><label key={value}><input type="radio" name="application-theme" value={value} checked={preference===value} onChange={()=>setApplicationTheme(value)}/>{label}</label>)}</fieldset>}
 </div>;
}
