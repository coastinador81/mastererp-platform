import React, {useEffect, useId, useRef, useState} from 'react';
import ApplicationIcon from '../../../../../../shared/ui/ApplicationIcon.jsx';
import {parsePurchaseDecimal, purchaseEquivalent, purchaseLineTotal, purchaseMoney} from './purchaseRequestAmounts.mjs';
import './purchaseRequestForm.css';

const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
const lineFields = [['descripcion','Descripción'], ['cantidad','Cantidad'], ['precio_unitario','Precio unitario']];
const currencyNames = {VES:'Bolívar', USD:'Dólar estadounidense', EUR:'Euro'};

function SupplierFields({id, onSelect, initial, loadSuppliers, disabled}) {
  const uid = useId();
  const [catalog, setCatalog] = useState({rows:initial, loading:false, error:false});
  const [filter, setFilter] = useState(null);
  const [active, setActive] = useState(-1);
  const loading = useRef(false), ready = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const load = async () => {
    if (ready.current || loading.current) return;
    loading.current = true;
    setCatalog(state => ({...state, loading:true, error:false}));
    try {
      const rows = await loadSuppliers();
      if (mounted.current) {
        ready.current = true;
        setCatalog({rows, loading:false, error:false});
      }
    } catch {
      if (mounted.current) setCatalog(state => ({...state, loading:false, error:true}));
    } finally {
      loading.current = false;
    }
  };
  useEffect(() => {
    if (id && !initial.find(row => row.id === id)?.codigo) load();
  }, [id]);
  const selected = catalog.rows.find(row => row.id === id) || initial.find(row => row.id === id);
  const choose = row => {
    setFilter(null);
    setActive(-1);
    onSelect(row.id);
  };
  return [['codigo','Código del proveedor'], ['nombre','Nombre del proveedor']].map(([key,label]) => {
    const value = selected?.[key] || (filter?.field === key ? filter.text : '');
    const open = !disabled && filter?.field === key && filter.open;
    const matches = open?catalog.rows.filter(row => normalize(row[key] || '').includes(normalize(value))):[];
    const rows = matches.slice(0, 12);
    const list = uid + '-' + key;
    return <div className="purchase-request-supplier" key={key}>
      <label htmlFor={list}>{label}</label>
      <div className="purchase-request-search-input">
      <ApplicationIcon name="search"/>
      <input id={list} role="combobox" aria-autocomplete="list" aria-expanded={!!open}
        aria-controls={open ? list+'-results' : undefined}
        aria-activedescendant={open && rows[active] ? list+'-'+active : undefined}
        value={value} disabled={disabled} maxLength={key === 'codigo' ? 80 : 200}
        onFocus={() => { load(); setFilter({field:key,text:value,open:true}); setActive(-1); }}
        onChange={event => { load(); onSelect(''); setFilter({field:key,text:event.target.value,open:true}); setActive(-1); }}
        onBlur={() => setFilter(state => state?.field === key ? {...state,open:false} : state)}
        onKeyDown={event => {
          if (event.key === 'Escape') setFilter(state => state ? {...state,open:false} : state);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setFilter({field:key,text:value,open:true});
            setActive(index => Math.max(0, Math.min(rows.length-1, index+(event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (rows.length) choose(rows[Math.max(0,active)]);
          }
        }}/>
      </div>
      {open && <div className="purchase-request-results">
        <ul id={list+'-results'} role="listbox" aria-label={label}>{rows.map((row,index) =>
          <li key={row.id} id={list+'-'+index} role="option" aria-selected={active === index}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(row)}>
            {row.codigo} · {row.nombre}
          </li>)}</ul>
        {(catalog.loading || catalog.error || !rows.length || matches.length > rows.length) &&
          <p role="status">{catalog.loading ? 'Cargando proveedores…' : catalog.error
            ? 'No se pudo completar la búsqueda. Edita el texto para reintentar.'
            : rows.length ? 'Escribe más para reducir los resultados.' : 'No hay coincidencias.'}</p>}
      </div>}
    </div>;
  });
}

export default function PurchaseRequestForm({draft,setDraft,options,loadSuppliers,save,busy,cancel}) {
  const [issue,setIssue] = useState('');
  const foreign = draft.moneda !== options.moneda_base;
  const precision = code => options.monedas.find(currency => currency.codigo === code)?.decimales ?? 2;
  const digits = precision(draft.moneda), baseDigits = precision(options.moneda_base);
  const lines = draft.lineas.map(line => purchaseLineTotal(line,digits));
  const total = lines.every(line => line.amount !== null) ? lines.reduce((sum,line) => sum+line.amount,0n) : null;
  const equivalent = foreign ? purchaseEquivalent(total,draft.tipo_cambio,digits,baseDigits) : null;
  const change = (field,value) => setDraft(current => ({...current,[field]:value}));
  const submit = event => {
    event.preventDefault();
    const rate = parsePurchaseDecimal(draft.tipo_cambio,12);
    if (!draft.proveedor_id) return setIssue('Selecciona un proveedor de los resultados de búsqueda.');
    if (total === null || draft.lineas.some(line => !line.descripcion.trim())) return setIssue('Revisa la descripción, cantidad, precio e importe de cada línea.');
    if (foreign && (!rate || !draft.cambio_fecha || !draft.cambio_fuente.trim())) return setIssue('Completa la tasa positiva, su fecha y su fuente.');
    setIssue('');
    save(event);
  };
  return <form className="supplier-form purchase-form purchase-request-form" onSubmit={submit}>
    {issue && <p className="notice error" role="alert">{issue}</p>}
    <section className="panel"><h2>Datos de la solicitud</h2><div className="supplier-fields">
      <SupplierFields id={draft.proveedor_id} onSelect={id => {change('proveedor_id',id);setIssue('');}}
        initial={options.proveedores} loadSuppliers={loadSuppliers} disabled={busy}/>
      <label>Fecha de solicitud<input type="date" required value={draft.fecha} onChange={event => {
        const fecha=event.target.value;
        setDraft(current => ({...current,fecha,...(foreign ? {} : {cambio_fecha:fecha})}));
      }}/></label>
      <label>Moneda<select aria-label="Moneda" required value={draft.moneda} onChange={event => {
        const moneda=event.target.value, same=moneda===options.moneda_base;
        setDraft(current => ({...current,moneda,tipo_cambio:same?'1':'',cambio_fecha:same?current.fecha:'',cambio_fuente:same?'misma moneda':'',
          lineas:current.lineas.map(line => ({...line,precio_unitario:''}))}));
      }}>{options.monedas.map(currency => <option key={currency.codigo} value={currency.codigo}>
        {currency.codigo}{currencyNames[currency.codigo]?' · '+currencyNames[currency.codigo]:''}
      </option>)}</select></label>
      <label className="purchase-request-reference">Referencia interna (opcional)<input maxLength={80} value={draft.numero} onChange={e=>change('numero',e.target.value)}/></label>
    </div></section>
    {foreign && <section className="panel"><h2>Conversión a {options.moneda_base}</h2><div className="supplier-fields purchase-request-rates">
      <label>Tasa ({options.moneda_base === 'VES' ? 'Bs.' : options.moneda_base} por {draft.moneda})
        <input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,12})?" value={draft.tipo_cambio} onChange={e=>change('tipo_cambio',e.target.value.replace(',','.'))}/></label>
      <label>Fecha de la tasa<input type="date" required value={draft.cambio_fecha} onChange={e=>change('cambio_fecha',e.target.value)}/></label>
      <label>Fuente de la tasa<input required maxLength={120} value={draft.cambio_fuente} onChange={e=>change('cambio_fuente',e.target.value)}/></label>
    </div></section>}
    <section className="panel"><h2>Líneas de compra</h2>
      <div className="purchase-request-line purchase-request-head" aria-hidden="true">
        <span>Descripción</span><span>Cantidad</span><span>Precio unitario</span><span>Importe</span><span/>
      </div>
      {draft.lineas.map((line,index) => <div className="purchase-request-row" key={index}>
        <div className="purchase-request-line" role="group" aria-label={'Línea '+(index+1)}>
          {lineFields.map(([field,label]) => <label key={field}><span>{label}</span><input required value={line[field]}
            maxLength={field==='descripcion'?500:25} inputMode={field==='descripcion'?undefined:'decimal'}
            pattern={field==='descripcion'?undefined:'[0-9]+([.][0-9]{1,6})?'}
            onChange={event => {
              const value=field==='descripcion'?event.target.value:event.target.value.replace(',','.');
              setDraft(current => ({...current,lineas:current.lineas.map((row,i) => i===index?{...row,[field]:value}:row)}));
            }}/></label>)}
          <output aria-label={'Importe de la línea '+(index+1)}>{purchaseMoney(lines[index].amount,digits,draft.moneda)}</output>
          <button type="button" className="secondary purchase-request-remove" aria-label={'Quitar línea '+(index+1)}
            title={'Quitar línea '+(index+1)} disabled={busy||draft.lineas.length===1}
            onClick={()=>setDraft(current=>({...current,lineas:current.lineas.filter((_,i)=>i!==index)}))}><ApplicationIcon name="trash"/></button>
        </div>
        {lines[index].precisionError && <p className="notice error">Línea {index+1}. Revisa la precisión del importe en {draft.moneda}.</p>}
      </div>)}
      <button type="button" className="secondary" disabled={busy||draft.lineas.length>=100}
        onClick={()=>setDraft(current=>({...current,lineas:[...current.lineas,{descripcion:'',cantidad:'1',precio_unitario:''}]}))}>+ Añadir línea</button>
    </section>
    <div className="panel purchase-request-footer">
      <p>Se guardará como borrador</p>
      <div aria-live="polite"><span>Total estimado</span> <strong>{purchaseMoney(total,digits,draft.moneda)}</strong>
        {foreign && <small>Equivalente referencial · {purchaseMoney(equivalent,baseDigits,options.moneda_base)}</small>}
      </div>
      <div className="actions"><button type="button" className="secondary" onClick={cancel} disabled={busy}>Cancelar</button>
        <button disabled={busy}>{busy?'Guardando…':'Guardar borrador'}</button></div>
    </div>
  </form>;
}
