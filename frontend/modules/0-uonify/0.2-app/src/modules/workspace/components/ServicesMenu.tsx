import '../styles/live-services.css';
import { USE_MOCKS } from '@/shared/api/config';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { closeServices, openWorkspacePage, selectService } from '../hooks/actions';
import { useUiStore } from '../hooks/uiStore';
import { useDismissOnPointerDown } from '../hooks/useDismiss';
import { useWorkspaceRoute } from '../hooks/useWorkspaceRoute';
import { servicesMenuRight } from '../model/placement';
import { SERVICE_CATALOG, WORKSPACE_PATH, type ServiceId } from '../model/services';

/**
 * Menú de servicios de Uonify (lanzador del espacio). Muestra los servicios
 * activos y el resto bajo «Más servicios próximamente» (decisión del dueño 23-10).
 * La lista, el orden y los estados salen de SERVICE_CATALOG (fuente única que
 * comparte con el panel de la Home). El Estudio es un acceso directo al chat
 * (vive en la conversación), no una vista de módulo.
 */
const ACTIVE_ENTRIES = SERVICE_CATALOG.filter(entry => entry.status === 'active');
const SOON_ENTRIES = SERVICE_CATALOG.filter(entry => entry.status === 'soon');

export function ServicesMenu({ trigger, preparing = false }: { trigger: RefObject<HTMLButtonElement | null>; preparing?: boolean }) {
  const open = useUiStore(state => state.servicesOpen);
  const { service: active } = useWorkspaceRoute();
  const menu = useRef<HTMLElement>(null);
  const [right, setRight] = useState<number | undefined>(undefined);
  const [more, setMore] = useState(false);

  useDismissOnPointerDown(open, [menu, trigger], () => closeServices());

  // Borde derecho bajo el del lanzador, pero nunca fuera de la pantalla por la izquierda.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element || !trigger.current) return;
    const bar = element.offsetParent?.getBoundingClientRect() ?? { right: window.innerWidth };
    setRight(servicesMenuRight(bar.right, trigger.current.getBoundingClientRect().right, element.offsetWidth));
  }, [open, trigger, more]);

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
        {ACTIVE_ENTRIES.map(entry => {
          if (entry.id === 'estudio') return (
            <button key="estudio" type="button" data-service="estudio" onClick={openEstudio}>
              <img src={entry.iconSrc} alt="" />
              <span>{entry.name}</span>
            </button>
          );
          const service = entry.id as ServiceId;
          return (
            <button key={service} type="button" data-service={service} className={service === active ? 'is-active' : undefined} onClick={() => goService(service)}>
              <img src={entry.iconSrc} alt="" />
              <span>{entry.name}</span>
            </button>
          );
        })}
        {more && SOON_ENTRIES.map(entry => (
          <button key={entry.id} type="button" className="is-coming" disabled aria-disabled="true" title="Próximamente">
            <img src={entry.iconSrc} alt="" />
            <span>{entry.name}</span>
            <small className="coming-tag">Próximamente</small>
          </button>
        ))}
      </div>
      <button type="button" className="services-more-toggle" aria-expanded={more} aria-controls="services-menu" onClick={() => setMore(value => !value)}>
        {more ? 'Ocultar próximos' : 'Más servicios próximamente'} <span aria-hidden="true">{more ? '▴' : '▾'}</span>
      </button>
      {!USE_MOCKS && !preparing && <button className="services-account-link" type="button" onClick={() => openWorkspacePage('/espacio/configuracion/cuenta')}>Mi cuenta →</button>}
    </section>
  );
}
