import React from 'react';
import {totalOf} from './suggestionReview.mjs';

const money=value=>'Bs. '+value.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function SuggestionComparison({original,node,final,draft,draftStage}){
 const nodeValue=node||(draftStage==='node'?draft:null);
 const finalValue=final||(draftStage==='purchasing'?draft:null);
 const cell=(value,key)=>!value?'Pendiente':key==='price'?money(Number(value.price)):key==='total'?money(totalOf(value)):value[key];
 return <section className="panel demo-suggestion-comparison"><h2>Propuesta y cambios por revisión</h2><p>La recomendación original se conserva. Cada revisión muestra su propia versión.</p><div className="table-scroll"><table><thead><tr><th scope="col">Dato</th><th scope="col">Recomendación IA · DEMO</th><th scope="col">Jefe de nodo{draftStage==='node'?' · borrador de revisión':''}</th><th scope="col">Jefe de compras{draftStage==='purchasing'?' · borrador de revisión':''}</th></tr></thead><tbody>{[['quantity','Cantidad'],['price','Precio estimado'],['supplier','Proveedor'],['total','Total estimado']].map(([key,label])=><tr key={key}><th scope="row">{label}</th><td>{cell(original,key)}</td><td className={nodeValue&&cell(nodeValue,key)!==cell(original,key)?'demo-review-changed':''}>{cell(nodeValue,key)}{nodeValue&&cell(nodeValue,key)!==cell(original,key)&&<small className="demo-review-time">Modificado frente a IA</small>}</td><td className={finalValue&&nodeValue&&cell(finalValue,key)!==cell(nodeValue,key)?'demo-review-changed':''}>{cell(finalValue,key)}{finalValue&&nodeValue&&cell(finalValue,key)!==cell(nodeValue,key)&&<small className="demo-review-time">Modificado frente al nodo</small>}</td></tr>)}</tbody></table></div></section>;
}
