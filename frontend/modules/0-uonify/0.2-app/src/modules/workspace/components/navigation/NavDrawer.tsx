import { Projects } from './Projects';
import { closeAccountMenu, closeNavDrawer, startNewThread } from '../../hooks/actions';
import { useUiStore } from '../../hooks/uiStore';
import { CloseIcon, PlusIcon } from '../ShellIcons';
import { RecentThreads } from './NavLists';

export function NavDrawer() {
  const open = useUiStore(state => state.navOpen);
  return (
    <>
      <div className="nav-drawer-scrim" id="nav-drawer-scrim" hidden={!open} onClick={() => closeNavDrawer()} />
      <aside className="nav-drawer" id="nav-drawer" role="dialog" aria-modal="true" aria-labelledby="nav-drawer-title" hidden={!open}>
        <div className="nav-drawer-head">
          <h2 id="nav-drawer-title">Hilos</h2>
          <button className="nav-drawer-close" id="nav-drawer-close" type="button" aria-label="Cerrar hilos" onClick={() => closeNavDrawer()}>
            <CloseIcon />
          </button>
        </div>
        <button
          className="nav-drawer-new js-new-thread"
          type="button"
          onClick={() => {
            closeAccountMenu();
            startNewThread();
          }}
        >
          <PlusIcon />
          Nuevo hilo
        </button>
        <div className="nav-drawer-body">
          <Projects />
          <section className="nav-drawer-section" aria-labelledby="nav-recents-title">
            <div className="nav-drawer-section-head">
              <h2 id="nav-recents-title">Recientes</h2>
            </div>
            <div className="nav-drawer-list" id="nav-drawer-recents">
              <RecentThreads />
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
