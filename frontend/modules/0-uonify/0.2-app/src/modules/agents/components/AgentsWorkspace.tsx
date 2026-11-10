import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useSheetEnter } from '@/modules/catalog';
import { ConversationDock, TopbarCenter, useWorkspaceUi } from '@/modules/workspace';
import { useAgentsDrawer } from '../hooks/useAgentsDrawer';
import { LIST_SECTIONS, findPredefined, findSection, type SectionAction, type SectionId } from '../model/catalog';
import { AGENTS_BASE_PATH, CREATE_SEGMENT, agentPath, createPath, sectionPath } from '../model/paths';
import { findDraft, useAgentsStore, type AgentDraft } from '../model/store';
import { AgentSheet, type AgentSheetData } from './AgentSheet';
import { AgentWizard } from './AgentWizard';
import { AgentsSidebar } from './AgentsSidebar';
import { SectionView } from './SectionView';
import '../styles/index.css';

const focusSoon = (find: () => HTMLElement | null) => requestAnimationFrame(() => find()?.focus({ preventScroll: true }));
const finePointer = () => typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: fine)').matches;

/**
 * Servicio Agentes en el espacio de trabajo, con la mesa de Producto y ERP · Finanzas: a la
 * izquierda el menú del Centro de Agentes o la lista abierta; en el centro, la conversación
 * con Uony, el apartado elegido, la ficha de un agente o el asistente «Crear agente».
 *   /espacio/agentes                         menú y conversación
 *   /espacio/agentes/<apartado>              apartado (lista en el panel o vista en el centro)
 *   /espacio/agentes/<apartado>/<agente>     ficha «Configuración del agente»
 *   /espacio/agentes/crear                   asistente de 6 pasos
 */
export function AgentsWorkspace() {
  const navigate = useNavigate();
  const { seccion, agente } = useParams();
  const drafts = useAgentsStore(state => state.drafts);
  const requestActivation = useAgentsStore(state => state.requestActivation);
  const creating = seccion === CREATE_SEGMENT;
  const section = findSection(seccion);
  const current: SectionId | null = section?.id ?? null;
  const listing = current ? LIST_SECTIONS.includes(current) : false;
  const predefined = current === 'predeterminados' ? findPredefined(agente) : null;
  const draft = current === 'personalizados' ? findDraft(drafts, agente) : null;
  const centerSection = section && !listing ? section : null;
  const sheet = creating ? CREATE_SEGMENT : agente && current ? `${current}/${agente}` : centerSection ? centerSection.id : 'none';
  const ui = useWorkspaceUi();
  const center = useRef<HTMLElement>(null);
  const { drawer, narrow, workbenchRef, toggleRef, railMainRef, onRailClick, onToggleClick, collapseUnpinned, foldUnpinned } = useAgentsDrawer(sheet, sheet !== 'none');
  useSheetEnter(center, sheet, '');

  // Un apartado o un agente que no existe vuelve al inicio del servicio.
  const unknown = Boolean(seccion && !creating && !section) || Boolean(agente && (creating || !listing || (!predefined && !draft)));
  useEffect(() => {
    if (unknown) void navigate(seccion && section && listing ? sectionPath(section.id) : AGENTS_BASE_PATH, { replace: true });
  }, [unknown, seccion, section, listing, navigate]);

  const openCenter = (path: string) => {
    foldUnpinned();
    void navigate(path);
    focusSoon(() => center.current);
  };

  const onOpenSection = (id: SectionId) => {
    if (LIST_SECTIONS.includes(id)) void navigate(sectionPath(id));
    else openCenter(sectionPath(id));
  };

  const onOpenAgent = (list: SectionId, id: string) => openCenter(agentPath(list, id));
  const onCreate = () => openCenter(createPath());

  const onClose = (detail: number) => {
    void navigate(current && listing && agente ? sectionPath(current) : AGENTS_BASE_PATH);
    if (!finePointer() && detail !== 0) focusSoon(() => center.current);
    else ui.focusComposer();
  };

  const talk = () => {
    void navigate(AGENTS_BASE_PATH);
    ui.focusComposer();
  };

  const onAction = (action: SectionAction) => {
    if (action === 'crear-agente') onCreate();
    else if (action === 'abrir-predeterminados') onOpenSection('predeterminados');
    else talk();
  };

  const onCreated = (created: AgentDraft) => {
    created.integrations.forEach(requestActivation);
    ui.announce?.(`Agente «${created.name}» creado en Agentes personalizados.`);
    openCenter(agentPath('personalizados', created.id));
  };

  const collapseFromCenter = (target: EventTarget) => {
    if (!(target instanceof Element) || !target.closest('[data-product-drawer]')) collapseUnpinned();
  };

  const sheetData: AgentSheetData | null = predefined
    ? { name: predefined.name, module: predefined.module, mode: predefined.mode, summary: predefined.summary, origin: 'predeterminado', knowledge: [], integrations: [], approvals: ['enviar', 'importes'] }
    : draft
      ? { name: draft.name, module: draft.module, mode: draft.mode, summary: draft.goal, origin: 'personalizado', knowledge: draft.knowledge, integrations: draft.integrations, approvals: draft.approvals, tone: draft.tone }
      : null;

  const renderCenter = () => {
    if (creating) return <AgentWizard onClose={onClose} onCreated={onCreated} />;
    if (sheetData) return <AgentSheet key={sheet} agent={sheetData} onClose={onClose} onTalk={talk} />;
    if (centerSection) return <SectionView key={centerSection.id} section={centerSection} onClose={onClose} onAction={onAction} onOpenAgent={id => onOpenAgent('predeterminados', id)} />;
    return (
      <div className="product-chat-anchor">
        <ConversationDock />
      </div>
    );
  };

  const centerLabel = creating ? 'Crear agente' : sheetData ? `Configuración del agente ${sheetData.name}` : centerSection?.label;

  return (
    <>
      <TopbarCenter>
        <span className="live-product-channel">Centro de agentes</span>
      </TopbarCenter>
      <section
        ref={workbenchRef}
        className={clsx('product-workbench agents-workbench', drawer.open && 'is-catalog-open', drawer.open && drawer.pinned && 'is-catalog-pinned')}
        aria-label="Agentes"
      >
        <AgentsSidebar
          current={current}
          selected={agente ?? null}
          drawer={drawer}
          narrow={narrow}
          navOpen={ui.isNavigationOpen}
          toggleRef={toggleRef}
          railMainRef={railMainRef}
          onRailClick={onRailClick}
          onToggleClick={onToggleClick}
          onOpenSection={onOpenSection}
          onOpenAgent={onOpenAgent}
          onCreate={onCreate}
        />
        <section
          ref={center}
          className="product-center"
          tabIndex={-1}
          aria-label={sheet !== 'none' ? centerLabel : undefined}
          onPointerDown={event => collapseFromCenter(event.target)}
          onFocus={event => collapseFromCenter(event.target)}
        >
          {renderCenter()}
        </section>
      </section>
    </>
  );
}
