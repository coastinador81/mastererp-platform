import '../styles/live-services.css';
import { USE_MOCKS } from '@/shared/api/config';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { closeServices, openWorkspacePage, selectService } from '../hooks/actions';
import { useUiStore } from '../hooks/uiStore';
import { useDismissOnPointerDown } from '../hooks/useDismiss';
import { useWorkspaceRoute } from '../hooks/useWorkspaceRoute';
import { servicesMenuRight } from '../model/placement';
import { SERVICES, serviceIcon, WORKSPACE_PATH, type ServiceId } from '../model/services';

/**
 * Menú de servicios de Uonify (lanzador del espacio). Todos los servicios están
 * activos. Orden: Producto, Estudio, ERP, Nexus y el resto. El Estudio es un
 * acceso directo al chat (vive en la conversación), no una vista de módulo.
 */
const VISIBLE_AFTER_PRODUCTO: ServiceId[] = ['erp', 'nexus', 'analitica', 'auditoria', 'agentes', 'academy', 'logistica', 'fabrica'];
const ESTUDIO_ICON = '/assets/product-icons/estudio.png';

export function ServicesMenu({ trigger, preparing = false }: { trigger: RefObject<HTMLButtonElement | null>; preparing?: boolean }) {
  const open = useUiStore(state => state.servicesOpen);
  const { service: active } = useWorkspaceRoute();
  const menu = useRef<HTMLElement>(null);
  const [right, setRight] = useState<number | undefined>(undefined);

  useDismissOnPointerDown(open, [menu, trigger], () => closeServices());

  // Borde derecho bajo el del lanzador, pero nunca fuera de la pantalla por la izquierda.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element || !trigger.current) return;
    const bar = element.offsetParent?.getBoundingClientRect() ?? { right: window.innerWidth };
    setRight(servicesMenuRight(bar.right, trigger.current.getBoundingClientRect().right, element.offsetWidth));
  }, [open, trigger]);

  const goService = (service: ServiceId) => {
    if (preparing) { closeServices(); document.querySelector<HTMLElement>('#activation-progress')?.focus(); }
    else selectService(service);
  };
  // El Estudio no es una vista de módulo: cierra el menú y vuelve al chat, donde vive.
  const openEstudio = () => {
    if (preparing) { closeServices(); document.querySelector<HTMLElement>('#activation-progress')?.focus(); return; }
    closeServices();
    openWorkspacePage(WORKSPACE_PATH);
  };

  const serviceButton = (service: ServiceId) => (
    <button key={service} type="button" data-service={service} className={service === active ? 'is-active' : undefined} onClick={() => goService(service)}>
      <img src={serviceIcon(service)} alt="" />
      <span>{SERVICES[service].name}</span>
    </button>
  );

  return (
    <section ref={menu} className="services-menu" id="services-menu" aria-label="Servicios de Uonify" hidden={!open} style={right === undefined ? undefined : { right }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeServices(true); }
    }}>
      <div className="services-menu-heading">
        <h2>Servicios de Uonify</h2>
        <a href="/productos" target="_blank" rel="noopener">
          Conocer Uonify <span aria-hidden="true">↗</span>
        </a>
      </div>
      {preparing && <p className="services-preparation-note">Termina de preparar tu cuenta para utilizar estas herramientas.</p>}
      <div className="services-grid">
        {serviceButton('producto')}
        <button key="estudio" type="button" data-service="estudio" onClick={openEstudio}>
          <img src={ESTUDIO_ICON} alt="" />
          <span>Estudio</span>
        </button>
        {VISIBLE_AFTER_PRODUCTO.map(serviceButton)}
      </div>
      {!USE_MOCKS && !preparing && <button className="services-account-link" type="button" onClick={() => openWorkspacePage('/espacio/configuracion/cuenta')}>Mi cuenta →</button>}
    </section>
  );
}
