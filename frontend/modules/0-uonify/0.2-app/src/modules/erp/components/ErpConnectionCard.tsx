import { useEffect, useId, useState } from 'react';
import { USE_MOCKS } from '@/shared/api/config';
import { Button, LinkButton, Select } from '@/shared/ui';
import { liveStart } from '../api/live';
import { useMastererp } from '../hooks/useMastererp';
import { consumeLoginReturn, loginReturnNotice } from '../model/loginReturn';
import '../styles/connection.css';

/**
 * Conexión con la cuenta de MasterERP dentro del panel de Finanzas y de la conversación,
 * como la de Drive: conectar, elegir espacio y empresa, o desconectar. Los avisos son los
 * textos de la app de Finanzas del equipo (session.jsx y Finance.jsx). El acceso se abre en
 * esta misma pestaña (sin ventana emergente) y el servidor devuelve a ERP · Finanzas. En la
 * vista local la conexión se simula con datos de ejemplo (mocks/demo.ts).
 */
export function ErpConnectionCard() {
  const { status, message, spaces, tenant, context, company, check, selectTenant, selectCompany, disconnect } = useMastererp();
  const uid = useId();
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState(loginReturnNotice);
  // Si la persona vuelve con «Atrás» desde MasterERP, el botón vuelve a estar disponible.
  useEffect(() => {
    consumeLoginReturn();
    const reset = (event: PageTransitionEvent) => { if (event.persisted) setLeaving(false); };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  const connect = () => {
    setNotice(null);
    if (!USE_MOCKS) {
      setLeaving(true);
      liveStart().then(
        url => window.location.assign(url),
        () => { setLeaving(false); setNotice('No se ha podido abrir el acceso a MasterERP. Vuelve a intentarlo.'); },
      );
      return;
    }
    void import('../mocks/demo').then(({ connectDemo }) => {
      connectDemo();
      return check();
    });
  };
  const on = status === 'connected';
  return (
    <section className="erp-connection" aria-labelledby={`${uid}-title`}>
      <div className="erp-connection-head">
        <h3 id={`${uid}-title`}>MasterERP</h3>
        <span className={on ? 'erp-connection-state is-on' : 'erp-connection-state'}>
          {on ? (USE_MOCKS ? 'Simulación' : 'Datos reales') : status === 'checking' ? 'Comprobando' : 'Sin conectar'}
        </span>
      </div>
      {message ? <p className="erp-connection-message" role="status">{message}</p> : null}
      {notice && !on ? <p className="erp-connection-message" role="status">{notice}</p> : null}
      {status === 'disconnected' || status === 'idle' ? (
        <>
          <p className="erp-connection-message">
            {USE_MOCKS
              ? 'Vista local: la conexión se simula con datos de ejemplo. En dev.uonify.com conectas tu cuenta real.'
              : 'Conecta tu cuenta de MasterERP para trabajar con los datos reales de Finanzas. El acceso se abre en esta pestaña y vuelves aquí al terminar.'}
          </p>
          <Button type="button" variant="primary" size="sm" disabled={leaving} onClick={connect}>{leaving ? 'Abriendo MasterERP…' : 'Conectar MasterERP'}</Button>
        </>
      ) : null}
      {on || status === 'no-access' ? (
        <div className="erp-connection-fields">
          {spaces.length > 1 ? (
            <label className="product-filter-field" htmlFor={`${uid}-tenant`}>
              <span>Espacio</span>
              <Select id={`${uid}-tenant`} value={tenant} onChange={event => void selectTenant(event.target.value)}>
                <option value="">Selecciona un espacio</option>
                {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
              </Select>
            </label>
          ) : null}
          {context && context.companies.length > 1 ? (
            <label className="product-filter-field" htmlFor={`${uid}-company`}>
              <span>Empresa</span>
              <Select id={`${uid}-company`} value={company} onChange={event => selectCompany(event.target.value)}>
                <option value="">Selecciona una empresa</option>
                {context.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
          ) : context?.companies.length === 1 ? (
            <p className="erp-connection-message">{spaces.find(space => space.id === tenant)?.name} · {context.companies[0].name}</p>
          ) : null}
          <LinkButton className="erp-connection-off" onClick={disconnect}>Desconectar</LinkButton>
        </div>
      ) : null}
      {status === 'error' ? <Button type="button" variant="outline" size="sm" onClick={() => void check()}>Revalidar acceso</Button> : null}
    </section>
  );
}
