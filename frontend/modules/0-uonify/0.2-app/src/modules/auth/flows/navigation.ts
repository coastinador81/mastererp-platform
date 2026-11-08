/**
 * Puente entre los flujos imperativos del acceso y React Router. <AuthDialogs/>
 * registra el `navigate` del router y la ruta actual; así openSignIn() y los
 * demás funcionan desde fuera de React.
 */
export const HOME_PATH = '/';
export const WORKSPACE_PATH = '/espacio';

type RouterNavigate = (to: string, options?: { replace?: boolean }) => void;

let routerNavigate: RouterNavigate | null = null;
let currentPath: string | null = null;
// Destino de una navegación pedida y aún no pintada (las guardas la respetan).
let pendingPath: string | null = null;
const waiters = new Set<() => void>();

export const navigation = {
  /** Lo llama <AuthDialogs/> en cada cambio de ruta. */
  bind(navigate: RouterNavigate, pathname: string): void {
    routerNavigate = navigate;
    currentPath = pathname;
    if (pendingPath === pathname) pendingPath = null;
    waiters.forEach(wake => wake());
  },
  unbind(navigate: RouterNavigate): void {
    if (routerNavigate === navigate) routerNavigate = null;
  },
  pathname(): string {
    return currentPath ?? window.location.pathname;
  },
  onWorkspace(): boolean {
    const path = navigation.pathname();
    return path === WORKSPACE_PATH || path.startsWith(`${WORKSPACE_PATH}/`);
  },
  onHome(): boolean {
    return navigation.pathname() === HOME_PATH;
  },
  /** Hay una navegación en curso hacia otra ruta. */
  navigating(): boolean {
    return pendingPath !== null && pendingPath !== navigation.pathname();
  },
  /** Navegación dentro de la aplicación (sin recargar). */
  go(to: string, options?: { replace?: boolean }): void {
    pendingPath = new URL(to, window.location.origin).pathname;
    if (routerNavigate) routerNavigate(to, options);
    else if (options?.replace) window.location.replace(to);
    else window.location.assign(to);
  },
  /**
   * Carga completa de la página (salir, volver tras un error o ir a OpenAI):
   * deja limpio el estado en memoria de todos los módulos, como el prototipo.
   * Reemplazable en pruebas.
   */
  hard(url: string): void {
    window.location.assign(url);
  },
  /** Espera a que la ruta cumpla la condición (o rechaza al agotar el tiempo). */
  waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wake = () => {
        if (!predicate()) return;
        cleanup();
        resolve();
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('navigation-timeout'));
      }, timeoutMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        waiters.delete(wake);
      };
      waiters.add(wake);
    });
  },
};

/** Solo pruebas. */
export function resetNavigation(): void {
  routerNavigate = null;
  currentPath = null;
  pendingPath = null;
  waiters.clear();
  navigation.hard = (url: string) => window.location.assign(url);
}
