import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/shared/ui';
import type { Party, PurchaseDocument, Sale } from '../api/finance';
import { useRealPage } from '../hooks/useRealData';
import { SOURCE_LABEL, amount, date, saleOrigin, saleState, type RealApartado } from '../model/real';
import { DrawerHeader } from './DrawerHeader';
import { FinanceIcon } from './FinanceMenu';

type Row = PurchaseDocument | Party | Sale;

/** Clave de la fila en la URL: la referencia opaca del servidor o, en la vista local, el id. */
export const refOf = (row: Row): string => row.ref ?? row.id ?? '';

interface Line {
  title: string;
  mono: boolean;
  lines: string[];
  label: string;
}

/** Lo que enseña cada fila, con los campos de las tablas del equipo (Purchases, SupplierRow y SaleRow). */
function lineOf(kind: RealApartado['kind'], row: Row): Line {
  if (kind === 'purchases') {
    const item = row as PurchaseDocument;
    const reference = item.numero || 'Sin referencia';
    const total = `${item.moneda} ${amount(item.total)}`;
    return { title: reference, mono: Boolean(item.numero), lines: [`${total} · ${item.proveedor ?? '—'}`, `${date(item.fecha)} · Borrador`], label: `${reference} · ${item.proveedor ?? ''} · ${total}` };
  }
  if (kind === 'parties') {
    const item = row as Party;
    const general = (item.datos_generales ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof general[key] === 'string' && general[key] ? (general[key] as string) : '—');
    return { title: item.nombre, mono: false, lines: [`${item.codigo} · ${text('numero_identificacion')}`, `${text('email')} · ${text('telefono')}`], label: `${item.codigo} · ${item.nombre}` };
  }
  const item = row as Sale;
  const total = `${amount(item.total, item.decimales ?? 2)} ${item.moneda}`;
  return { title: item.numero, mono: true, lines: [`${total} · ${item.cliente?.nombre ?? '—'}`, `${date(item.fecha)} · ${saleOrigin(item.origen)} · ${saleState(item.estado)}`], label: `${item.numero} · ${item.cliente?.nombre ?? ''} · ${total}` };
}

/** Recuento del pie, literal de cada pantalla del equipo. */
function footerOf(apartado: RealApartado, count: number, paged: boolean): string {
  if (apartado.kind === 'purchases') return '10 registros por página';
  return `Mostrando ${count} ${apartado.plural}${paged ? ' en esta página' : ''}.`;
}

export interface RealListPanelProps {
  apartado: RealApartado;
  selected: string | null;
  navOpen: boolean;
  onBack: () => void;
  onOpen: (reference: string) => void;
}

/**
 * Lista de un apartado con datos reales en el panel lateral, con las clases del catálogo de
 * Producto: 10 por página con el cursor de la API, como las pantallas del equipo. Solo Ventas
 * busca en el servidor (q); los demás no tienen búsqueda en la API y no se simula aquí.
 */
export function RealListPanel({ apartado, selected, navOpen, onBack, onOpen }: RealListPanelProps) {
  const sales = apartado.kind === 'sales';
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  // Como Sales.jsx: la búsqueda espera 300 ms a que se deje de escribir.
  useEffect(() => {
    if (term.trim() === search) return undefined;
    const timer = setTimeout(() => setSearch(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term, search]);
  const page = useRealPage<Row>(apartado.collection, apartado.messages, sales ? search : '');
  const loading = page.status === 'loading' || page.status === 'idle';
  const paged = page.hasPrevious || page.hasNext;
  const retry = page.errorStatus !== 401 && page.errorStatus !== 403;

  let body: ReactNode;
  if (page.status === 'error') {
    body = (
      <div className="product-catalog-empty" role="alert">
        <strong>{page.error}</strong>
        {retry ? <button type="button" className="secondary-action" onClick={page.reload}>{sales ? 'Reintentar' : apartado.kind === 'parties' ? 'Recargar datos' : 'Recargar'}</button> : null}
      </div>
    );
  } else if (loading) {
    body = <div className="product-catalog-empty" role="status"><strong>{apartado.loading}</strong></div>;
  } else if (!page.items.length) {
    body = (
      <div className="product-catalog-empty">
        <strong>{sales && search ? 'No se encontraron ventas para esta búsqueda.' : apartado.empty}</strong>
      </div>
    );
  } else {
    body = page.items.map(row => {
      const reference = refOf(row);
      const line = lineOf(apartado.kind, row);
      return (
        <div key={reference} className="product-catalog-row">
          <button
            type="button"
            className={clsx('product-catalog-item', reference === selected && 'is-selected')}
            aria-current={reference === selected ? 'true' : undefined}
            title={line.label}
            onClick={() => onOpen(reference)}
          >
            <span className="product-item-thumb erp-item-thumb" aria-hidden="true">
              {apartado.kind === 'parties' ? <FinanceIcon name={apartado.route === 'clientes' ? 'clients' : 'supplier'} /> : <Icon name="file" size={18} strokeWidth={1.7} />}
            </span>
            <span>
              <strong className={line.mono ? 'pim-mono' : undefined}>{line.title}</strong>
              {line.lines.map(text => <small key={text}>{text}</small>)}
            </span>
          </button>
        </div>
      );
    });
  }

  return (
    <>
      <DrawerHeader eyebrow={SOURCE_LABEL} title={apartado.title} navOpen={navOpen} onBack={onBack} />
      {apartado.description ? <p className="erp-drawer-description">{apartado.description}</p> : null}
      {sales ? (
        <label className="product-search erp-real-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Buscar ventas"
            placeholder="Buscar por venta, cliente o pedido"
            maxLength={120}
            value={term}
            onChange={event => setTerm(event.target.value)}
          />
        </label>
      ) : null}
      <div className="product-catalog-list" aria-busy={loading}>
        {body}
      </div>
      <div className="erp-real-pagination">
        <span role="status">{page.status === 'ready' ? footerOf(apartado, page.items.length, paged) : ''}</span>
        <div>
          <button type="button" className="secondary-action" disabled={loading || !page.hasPrevious} onClick={page.previous}>Anterior</button>
          <button type="button" className="secondary-action" disabled={loading || !page.hasNext} onClick={page.next}>Siguiente</button>
        </div>
      </div>
    </>
  );
}
