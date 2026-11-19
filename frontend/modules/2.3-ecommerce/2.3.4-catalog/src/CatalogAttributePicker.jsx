import React, {useMemo, useState} from 'react';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import {filterAttributesForSearch} from './catalogModel.mjs';

export default function CatalogAttributePicker({attributeOptions = [], selectedCodes = [], disabled, onToggle}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const attributeByCode = useMemo(() => Object.fromEntries(attributeOptions.map(item => [item.code, item])), [attributeOptions]);
  const pickable = filterAttributesForSearch(attributeOptions, query, selectedCodes, 20);
  const closeSoon = () => window.setTimeout(() => setOpen(false), 160);

  const attributeRow = (attribute, checked) => (
    <label className="cat-supplier-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onToggle(attribute.code, event.target.checked)}/>
      <span>
        <strong>{attribute.name}</strong>
        <small>{attribute.code}</small>
        {Array.isArray(attribute.options) && attribute.options.length > 0 && (
          <small>{attribute.options.slice(0, 4).join(', ')}{attribute.options.length > 4 ? '…' : ''}</small>
        )}
      </span>
    </label>
  );

  return (
    <div className="cat-full cat-attribute-picker cat-search-picker">
      {attributeOptions.length ? (
        <>
          <div className="cat-supplier-search">
            <label className="cat-search">
              <FinanceIcon name="search"/>
              <input
                type="search"
                aria-label="Buscar atributo"
                aria-expanded={open}
                aria-controls="cat-attribute-options"
                placeholder="Buscar atributos para variantes…"
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
              <ul className="cat-supplier-options cat-supplier-dropdown" id="cat-attribute-options" role="listbox" aria-label="Atributos disponibles">
                {pickable.length ? pickable.map(attribute => (
                  <li className="cat-supplier-option" key={attribute.code} role="presentation" onMouseDown={event => event.preventDefault()}>
                    {attributeRow(attribute, false)}
                  </li>
                )) : (
                  <li className="cat-supplier-no-match" role="presentation">
                    {query.trim() ? 'No hay más coincidencias.' : 'Todos los atributos visibles ya están seleccionados.'}
                  </li>
                )}
              </ul>
            )}
          </div>
          <section className="cat-supplier-chosen" aria-labelledby="cat-attribute-chosen-title">
            <h3 className="cat-supplier-section-label" id="cat-attribute-chosen-title">Seleccionados</h3>
            {selectedCodes.length ? (
              <ul className="cat-supplier-chosen-list">
                {selectedCodes.map(code => {
                  const attribute = attributeByCode[code];
                  if (!attribute) return null;
                  return (
                    <li className="cat-supplier-option is-selected" key={code}>
                      {attributeRow(attribute, true)}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="cat-supplier-hint">Ningún atributo seleccionado todavía.</p>
            )}
          </section>
        </>
      ) : (
        <div className="cat-attribute-empty"><strong>No hay atributos disponibles</strong><p>Añade una plantilla o crea un atributo personalizado.</p></div>
      )}
    </div>
  );
}