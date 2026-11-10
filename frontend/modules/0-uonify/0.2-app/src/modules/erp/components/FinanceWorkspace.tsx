import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useSheetEnter } from '@/modules/catalog';
import { USE_MOCKS } from '@/shared/api/config';
import { ConversationDock, TopbarCenter, useWorkspaceUi } from '@/modules/workspace';
import { useFinanceDrawer } from '../hooks/useFinanceDrawer';
import { useFinanceFilters } from '../hooks/useFinanceFilters';
import { readyScope, useMastererp } from '../hooks/useMastererp';
import { useListRows } from '../hooks/useSuggestions';
import { EMPTY_FILTERS, findDocument } from '../model/demoPurchases';
import { listOf } from '../model/lists';
import { modeOf as modeFor } from '../model/mode';
import { FINANCE_BASE_PATH, PURCHASES_ROUTE, SUGGESTIONS_ROUTE, SUMMARY_ROUTE, apartadoPath, documentPath, purchasePath } from '../model/paths';
import { realApartado } from '../model/real';
import { findSuggestion } from '../model/suggestions';
import { FinanceSidebar } from './FinanceSidebar';
import { PurchaseSheet } from './PurchaseSheet';
import { PurchasesSummaryView } from './PurchasesSummaryView';
import { RealRecordSheet } from './RealRecordSheet';
import { SuggestionSheet } from './SuggestionSheet';
import '../styles/index.css';
import '../styles/summary.css';

const focusSoon = (find: () => HTMLElement | null) => requestAnimationFrame(() => find()?.focus({ preventScroll: true }));
const finePointer = () => typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: fine)').matches;

/** Lo que enseña la demo del equipo ante una referencia que no existe (PurchasesListPreview.jsx:30 y PurchaseSuggestionsPreview.jsx:30). */
function Missing({ title, text, back, onBack }: { title: string; text?: string; back: string; onBack: (detail: number) => void }) {
  return (
    <div className="product-editor-layout erp-sheet">
      <header className="product-center-header">
        <div className="product-source-header-summary">
          <div className="product-center-title">
            <h1>{title}</h1>
            {text ? <p>{text}</p> : null}
          </div>
        </div>
      </header>
      <div>
        <button type="button" className="secondary-action" onClick={event => onBack(event.detail)}>{back}</button>
      </div>
    </div>
  );
}

/**
 * Servicio ERP · Finanzas en el espacio de trabajo, con la misma mesa que Producto
 * (catalog/components/ProductWorkspace.tsx): a la izquierda el menú de Finanzas del
 * equipo, o la lista del apartado abierto; en el centro, la conversación con Uony, la
 * ficha elegida o el Resumen de compras. Las clases product-* son las del catálogo.
 * Uony todavía no lee lo que hay abierto: eso llega al conectar las APIs de Finanzas.
 */
export function FinanceWorkspace() {
  const navigate = useNavigate();
  const { apartado, referencia } = useParams();
  const connectionStatus = useMastererp(state => state.status);
  const check = useMastererp(state => state.check);
  const ready = useMastererp(state => readyScope(state) !== null);
  const context = useMastererp(state => state.context);
  const modeOf = (route: string | null | undefined) => modeFor(route, { ready, context, local: USE_MOCKS });
  const mode = modeOf(apartado);
  const usable = mode === 'real' || mode === 'demo';
  // Mientras se valida la conexión, un apartado real todavía no se puede decidir.
  const pending = Boolean(realApartado(apartado)) && (connectionStatus === 'idle' || connectionStatus === 'checking');
  const current = usable ? apartado ?? null : null;
  const real = mode === 'real' ? realApartado(current) : undefined;
  const list = real ? undefined : listOf(current);
  const rows = useListRows(list);
  const summary = current === SUMMARY_ROUTE;
  const suggesting = current === SUGGESTIONS_ROUTE;
  const doc = list ? findDocument(rows, referencia) : null;
  const suggestion = suggesting ? findSuggestion(referencia) : null;
  const sheet = summary ? SUMMARY_ROUTE : current && referencia ? `${current}/${referencia}` : 'none';
  const ui = useWorkspaceUi();
  const center = useRef<HTMLElement>(null);
  const { drawer, narrow, workbenchRef, toggleRef, railMainRef, onRailClick, onToggleClick, collapseUnpinned, foldUnpinned } =
    useFinanceDrawer(sheet, sheet !== 'none');
  useSheetEnter(center, sheet, '');

  // La conexión con el ERP se valida al entrar en Finanzas, no solo al ver la tarjeta del menú.
  useEffect(() => {
    if (connectionStatus === 'idle') void check();
  }, [connectionStatus, check]);

  // Un apartado que no existe o que aún no está aquí (o una ficha dentro del Resumen) vuelve al inicio.
  useEffect(() => {
    if (pending) return;
    if ((apartado && !usable) || (summary && referencia)) void navigate(FINANCE_BASE_PATH, { replace: true });
  }, [apartado, usable, pending, summary, referencia, navigate]);

  // Las listas se abren en el panel; el Resumen, en el centro: como una ficha de Producto,
  // pliega la lista si no está fijada y lleva el foco al centro.
  const onOpenApartado = (route: string) => {
    if (route === SUMMARY_ROUTE) foldUnpinned();
    void navigate(apartadoPath(route));
    if (route === SUMMARY_ROUTE) focusSoon(() => center.current);
  };

  // La compra creada al aprobar sale primero en Compras: sus filtros vuelven a los de partida.
  // Con datos reales, Compras es la del ERP y la sugerencia sigue siendo de ejemplo: se vuelve a la lista.
  const onApproved = (reference: string) => {
    if (modeOf(PURCHASES_ROUTE) !== 'demo') {
      void navigate(apartadoPath(SUGGESTIONS_ROUTE));
      return;
    }
    useFinanceFilters.getState().setFilters(PURCHASES_ROUTE, EMPTY_FILTERS);
    void navigate(purchasePath(reference));
    focusSoon(() => center.current);
  };

  const onOpenDocument = (reference: string) => {
    if (!current) return;
    foldUnpinned();
    void navigate(documentPath(current, reference));
    focusSoon(() => center.current);
  };

  // Como Producto: con ratón o teclado el foco vuelve al compositor; con el dedo, al centro.
  const onClose = (detail: number) => {
    void navigate(current && !summary ? apartadoPath(current) : FINANCE_BASE_PATH);
    if (!finePointer() && detail !== 0) focusSoon(() => center.current);
    else ui.focusComposer();
  };

  const collapseFromCenter = (target: EventTarget) => {
    if (!(target instanceof Element) || !target.closest('[data-product-drawer]')) collapseUnpinned();
  };

  const renderCenter = () => {
    if (summary) return <PurchasesSummaryView onClose={onClose} />;
    if (real && referencia) return <RealRecordSheet key={referencia} apartado={real} reference={referencia} onClose={onClose} />;
    if (list && doc) return <PurchaseSheet purchase={doc} kind={list.kind} onClose={onClose} />;
    if (list && referencia) return <Missing title="Documento no disponible" text="La referencia no corresponde a un documento DEMO." back={`Volver a ${list.title}`} onBack={onClose} />;
    if (suggestion) return <SuggestionSheet key={suggestion.id} suggestion={suggestion} onClose={onClose} onApproved={onApproved} />;
    if (suggesting && referencia) return <Missing title="Sugerencia no disponible" back="Volver a sugerencias" onBack={onClose} />;
    return (
      <div className="product-chat-anchor">
        <ConversationDock />
      </div>
    );
  };

  const centerLabel = summary ? 'Resumen de compras' : suggesting ? 'Sugerencia de compra' : real ? `Ficha · ${real.title}` : list?.kind === 'orders' ? 'Ficha de orden de compra' : 'Ficha de compra';

  return (
    <>
      <TopbarCenter>
        <span className="live-product-channel">{USE_MOCKS ? (ready ? 'Vista local · ERP simulado' : 'Vista local · Datos ficticios') : ready ? 'Datos reales del ERP' : 'Sin conexión con el ERP'}</span>
      </TopbarCenter>
      <section
        ref={workbenchRef}
        className={clsx('product-workbench erp-workbench', drawer.open && 'is-catalog-open', drawer.open && drawer.pinned && 'is-catalog-pinned')}
        aria-label="Finanzas"
      >
        <FinanceSidebar
          current={current}
          real={real}
          modeOf={modeOf}
          selected={real ? referencia ?? null : doc?.reference ?? (suggestion ? referencia ?? null : null)}
          drawer={drawer}
          narrow={narrow}
          navOpen={ui.isNavigationOpen}
          toggleRef={toggleRef}
          railMainRef={railMainRef}
          onRailClick={onRailClick}
          onToggleClick={onToggleClick}
          onOpenApartado={onOpenApartado}
          onOpenDocument={onOpenDocument}
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
