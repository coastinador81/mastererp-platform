import React from 'react';
export default function ReviewTime({value}){
 if(!value)return <span>Pendiente</span>;
 return <time dateTime={value}>{new Intl.DateTimeFormat('es-VE',{dateStyle:'short',timeStyle:'medium',timeZoneName:undefined}).format(new Date(value))}</time>;
}
