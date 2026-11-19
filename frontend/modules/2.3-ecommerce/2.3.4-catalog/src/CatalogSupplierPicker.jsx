import React, {useMemo, useState} from 'react';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import {filterSuppliersForSearch} from './catalogModel.mjs';

export default function CatalogSupplierPicker({supplierOptions = [], relations = [], disabled, onToggle}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const supplierById = useMemo(() => Object.fromEntries(supplierOptions.map(item => [item.id, item])), [supplierOptions]);
  const selectedIds = useMemo(() => relations.map(item => item.id), [relations]);
  const pickable = filterSuppliersForSearch(supplierOptions, query, selectedIds, 20);
  const closeSoon = () => window.setTimeout(() => setOpen(false), 160);

  const supplierRow = (supplier, checked) => (
    <label className="cat-supplier-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onToggle(supplier, event.target.checked)}/>
      <span>
        <strong>{supplier.name}</strong>
        <small>{supplier.code}</small>
        {(supplier.contact?.email || supplier.contact?.phone) && (
          <small>{[supplier.contact?.email, supplier.contact?.phone].filter(Boolean).join(' · ')}</small>
        )}
      </span>
    </label>
  );

  return (
    <fieldset className="cat-full cat-suppliers cat-supplier-picker">
      <legend>Proveedores</legend>
      <p className="cat-supplier-hint cat-supplier-picker-intro">Los datos comerciales del proveedor se gestionan en su propia ficha.</p>
      {supplierOptions.length ? (
        <>
          <div className="cat-supplier-search">
            <label className="cat-search">
              <FinanceIcon name="search"/>
              <input
                type="search"
                aria-label="Buscar proveedor"
                aria-expanded={open}
                aria-controls="cat-supplier-options"
                placeholder="Buscar y seleccionar proveedores…"
                value={query}
                disabled={disabled}
                onChange={event => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={closeSoon}
                onKeyDown={event => {
                  if (event.key === 'Escape') setOpen(false);
                }}
              />
            </label>
            {open && (
              <ul className="cat-supplier-options cat-supplier-dropdown" id="cat-supplier-options" role="listbox" aria-label="Proveedores disponibles">
                {pickable.length ? pickable.map(supplier => (
                  <li className="cat-supplier-option" key={supplier.id} role="presentation" onMouseDown={event => event.preventDefault()}>
                    {supplierRow(supplier, false)}
                  </li>
                )) : (
                  <li className="cat-supplier-no-match" role="presentation">
                    {query.trim() ? 'No hay más coincidencias.' : 'Todos los proveedores activos ya están seleccionados.'}
                  </li>
                )}
              </ul>
            )}
          </div>
          <section className="cat-supplier-chosen" aria-labelledby="cat-supplier-chosen-title">
            <h3 className="cat-supplier-section-label" id="cat-supplier-chosen-title">Seleccionados</h3>
            {relations.length ? (
              <ul className="cat-supplier-chosen-list">
                {relations.map(relation => {
                  const supplier = supplierById[relation.id];
                  if (!supplier) return null;
                  return (
                    <li className="cat-supplier-option is-selected" key={relation.id}>
                      {supplierRow(supplier, true)}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="cat-supplier-hint">Ningún proveedor vinculado todavía.</p>
            )}
          </section>
        </>
      ) : (
        <p className="cat-supplier-hint">No hay proveedores activos disponibles.</p>
      )}
    </fieldset>
  );
}