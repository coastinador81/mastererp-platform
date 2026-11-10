import { Icon } from '@/shared/ui';
import type { Party, PurchaseDocument, Sale } from '../api/finance';
import { useRealRecord } from '../hooks/useRealData';
import { SOURCE_LABEL, amount, date, saleOrigin, saleState, type RealApartado } from '../model/real';
import { FinanceIcon } from './FinanceMenu';
import { Fields, Section, SheetHeader, mono, type Row } from './SheetParts';

const LABELS: Record<string, string> = {
  contado: 'Contado', credito: 'Crédito', por_acordar: 'Por acordar', transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', otro: 'Otro', natural: 'Persona natural', juridica: 'Persona jurídica',
};
/** Vacío = «Sin especificar», como CustomerOverview.jsx del equipo. */
const show = (value: unknown) => (value === undefined || value === null || value === '' ? 'Sin especificar' : String(value));

function PurchaseBody({ data }: { data: PurchaseDocument }) {
  return (
    <>
      <Section title="Información general">
        <Fields items={[
          ['Proveedor', data.proveedor ?? '—'],
          ['Fecha', mono(date(data.fecha))],
          ['Total', mono(`${data.moneda} ${amount(data.total)}`)],
          ['Total en moneda base', mono(`${data.moneda_base ?? '—'} ${amount(data.total_base)}`)],
          ['Tipo de cambio', `${data.tipo_cambio ?? '—'} · ${date(data.cambio_fecha)} · ${data.cambio_fuente ?? '—'}`],
          ...(data.version === undefined ? [] : [['Versión', mono(String(data.version))] as Row]),
        ]} />
      </Section>
      <Section title="Líneas" note={data.editable ? undefined : 'Tiene un documento derivado; este borrador se conserva sin cambios.'}>
        <div className="erp-table-scroll">
          <table className="erp-table">
            <thead><tr>{['Descripción', 'Cantidad', 'Precio', 'Total'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {(data.lineas ?? []).map((line, index) => (
                <tr key={index}>
                  <td>{line.descripcion}</td>
                  <td className="erp-num">{amount(line.cantidad, 0)}</td>
                  <td className="erp-num">{amount(line.precio_unitario)}</td>
                  <td className="erp-num">{amount(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function PartyBody({ data }: { data: Party & { contacto_ecommerce?: { email?: string; telefono?: string } | null } }) {
  const general = (data.datos_generales ?? {}) as Record<string, unknown>;
  const terms = (data.condiciones ?? {}) as Record<string, unknown>;
  const label = (value: unknown) => (typeof value === 'string' ? LABELS[value] ?? value : value);
  const group = (entries: Array<[string, unknown]>): Row[] => entries.map(([key, value]) => [key, show(value)]);
  return (
    <>
      <Section title="Relación administrativa">
        <p className="pim-section-sub erp-note">Origen: {data.origen === 'ecommerce' ? 'eCommerce' : 'Sin canal de origen identificado'}. La ficha fiscal y de contacto es común a Clientes y Proveedores; las condiciones son específicas de la empresa activa y del rol.</p>
        <Fields items={[['Roles en esta empresa', (data.roles ?? []).join(', ') || '—'], ...(data.version === undefined ? [] : [['Versión', mono(String(data.version))] as Row])]} />
      </Section>
      <Section title="Identificación administrativa" note="Código y nombre pertenecen al tercero común. La información fiscal disponible se muestra sin validación ante organismos externos.">
        <Fields items={[
          ['Código', mono(data.codigo)],
          ['Nombre', data.nombre],
          ...group([['Nombre comercial', general.nombre_comercial], ['Tipo de persona', label(general.tipo_persona)], ['País fiscal', general.pais_fiscal], ['Tipo de identificación', general.tipo_identificacion], ['Identificación fiscal', general.numero_identificacion]]),
        ]} />
      </Section>
      <Section title="Contacto administrativo">
        <Fields items={group([
          ['Correo administrativo', general.email], ['Teléfono', general.telefono], ['Teléfono alternativo', general.telefono_alterno],
          ['Dirección administrativa', general.direccion], ['Complemento', general.direccion_complementaria], ['Ciudad', general.ciudad],
          ['Municipio', general.municipio], ['Estado o provincia', general.region], ['Código postal', general.codigo_postal], ['País', general.pais],
        ])} />
      </Section>
      <Section title="Condiciones comerciales" note="Son preferencias registradas; no conceden crédito ni aplican descuentos por sí solas.">
        <Fields items={group([
          ['Moneda preferida', terms.moneda], ['Condición de pago', label(terms.condicion_pago)], ['Plazo de pago (días)', terms.plazo_pago_dias],
          ['Medio de pago', label(terms.medio_pago)], ['Descuento por pronto pago (%)', terms.descuento_pronto_pago], ['Plazo de pronto pago (días)', terms.plazo_pronto_pago_dias],
        ])} />
      </Section>
      <Section title="Personas de contacto">
        {data.contactos?.length ? (
          <Fields items={data.contactos.map((contact, index): Row => [
            `Contacto ${index + 1}${contact.principal ? ' · Principal' : ''}`,
            [contact.nombre, contact.cargo, contact.email, contact.telefono].filter(Boolean).join(' · ') || 'Sin especificar',
          ])} />
        ) : <p className="pim-section-sub erp-note">Sin contactos administrativos registrados.</p>}
      </Section>
      <Section title="Notas administrativas">
        <p className="pim-section-sub erp-note">{show(general.observaciones) === 'Sin especificar' ? 'Sin observaciones' : String(general.observaciones)}</p>
      </Section>
      <Section title="Situación financiera y documentos">
        <p className="pim-section-sub erp-note">La consulta integrada de saldos, vencimientos, anticipos, facturas y cobros está pendiente de conectar. Esta ficha no muestra importes simulados.</p>
      </Section>
    </>
  );
}

function SaleBody({ data }: { data: Sale }) {
  const decimals = data.decimales ?? 2;
  const foreign = data.moneda_base && data.moneda !== data.moneda_base;
  return (
    <>
      <Section title={data.numero}>
        <Fields items={[
          ['Fecha', mono(date(data.fecha))],
          ['Cliente', data.cliente?.nombre ?? '—'],
          ['Código de referencia del cliente', mono(data.cliente?.codigo ?? '—')],
          ['Origen', saleOrigin(data.origen)],
          ['Pedido de origen', mono(data.pedido?.numero ?? '—')],
        ]} />
      </Section>
      <Section title="Importe de la venta">
        <Fields items={[
          ['Total', mono(`${amount(data.total, decimals)} ${data.moneda}`)],
          ...(foreign ? [
            [`Total en ${data.moneda_base}`, mono(amount(data.total_base, data.decimales_base ?? 2))],
            ['Tipo de cambio', mono(amount(data.tipo_cambio, 0))],
            ['Fecha del cambio', mono(date(data.cambio_fecha))],
            ['Fuente del cambio', data.cambio_fuente ?? '—'],
          ] as Row[] : []),
        ]} />
      </Section>
      <Section title="Detalle de la venta" note={`Importes en ${data.moneda}`}>
        <div className="erp-table-scroll">
          <table className="erp-table">
            <thead><tr>{['Descripción', 'Cantidad', 'Precio unitario', 'Subtotal', 'Descuento', 'Recargo', 'Tributos', 'Total'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {(data.lineas ?? []).map(line => (
                <tr key={line.posicion}>
                  <td>{line.descripcion}</td>
                  <td className="erp-num">{amount(line.cantidad, 0)}</td>
                  {[line.precio_unitario, line.subtotal, line.descuento, line.recargo, line.tributos, line.total].map((value, index) => (
                    <td key={index} className="erp-num">{amount(value, decimals)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function headerOf(apartado: RealApartado, data: PurchaseDocument | Party | Sale) {
  if (apartado.kind === 'purchases') {
    const item = data as PurchaseDocument;
    const version = item.version === undefined ? '' : ` · Versión ${item.version}`;
    return { title: item.numero || 'Sin referencia', monoTitle: Boolean(item.numero), subtitle: item.proveedor ?? apartado.title, status: `Borrador · ${item.numero || 'Sin referencia'}${version}` };
  }
  if (apartado.kind === 'parties') {
    const item = data as Party;
    return { title: item.nombre, monoTitle: false, subtitle: item.codigo, status: `${SOURCE_LABEL} · ${apartado.title}` };
  }
  const item = data as Sale;
  return { title: 'Detalle de venta', monoTitle: false, subtitle: 'Información de la venta registrada y su pedido de origen.', status: saleState(item.estado) };
}

export interface RealRecordSheetProps {
  apartado: RealApartado;
  reference: string;
  onClose: (detail: number) => void;
}

/**
 * Ficha con datos reales en el centro, con la cabecera de Producto y el kit (pim-*), y los
 * campos y textos de las fichas del equipo (Purchases.jsx, CustomerOverview.jsx y
 * SaleDetail.jsx). Solo lectura: crear y editar siguen en la app de Finanzas del equipo.
 */
export function RealRecordSheet({ apartado, reference, onClose }: RealRecordSheetProps) {
  const record = useRealRecord<PurchaseDocument | Party | Sale>(apartado.collection, reference, apartado.messages);
  const icon = apartado.kind === 'parties'
    ? <FinanceIcon name={apartado.route === 'clientes' ? 'clients' : 'supplier'} />
    : <Icon name="file" size={26} strokeWidth={1.7} />;
  if (!record.data) {
    const failed = record.status === 'error';
    return (
      <div className="product-editor-layout erp-sheet">
        <SheetHeader
          icon={icon}
          title={apartado.title}
          subtitle={failed ? record.error ?? '' : apartado.kind === 'sales' ? 'Cargando venta…' : apartado.loading}
          status={SOURCE_LABEL}
          closeLabel="Cerrar ficha"
          onClose={onClose}
        />
        {failed && record.errorStatus !== 401 && record.errorStatus !== 403 ? (
          <div><button type="button" className="secondary-action" onClick={record.reload}>Recargar</button></div>
        ) : null}
      </div>
    );
  }
  const head = headerOf(apartado, record.data);
  return (
    <div className="product-editor-layout erp-sheet">
      <SheetHeader icon={icon} title={head.title} monoTitle={head.monoTitle} subtitle={head.subtitle} status={head.status} closeLabel="Cerrar ficha" onClose={onClose} />
      <div className="product-editor-surface pim-tab">
        {apartado.kind === 'purchases' ? <PurchaseBody data={record.data as PurchaseDocument} /> : null}
        {apartado.kind === 'parties' ? <PartyBody data={record.data as Party} /> : null}
        {apartado.kind === 'sales' ? <SaleBody data={record.data as Sale} /> : null}
      </div>
    </div>
  );
}
