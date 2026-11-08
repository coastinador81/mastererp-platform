import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AMAZON_INTENT_TTL, amazonIntentQuery, clearAmazonIntent, rememberAmazonIntent, useAmazonIntent } from '@/modules/amazon';
import { isAuthReturn } from '../model/authUrl';
import { flowActive, useAuthUi } from '../state/authUi';
import { bootAuth } from '../flows/boot';
import { HOME_PATH, navigation, WORKSPACE_PATH } from '../flows/navigation';
import { showProfile } from '../flows/profile';
import { openSignInDialog } from '../flows/access';
import { useSession } from './useSession';
import { recoverPendingAccountDeletion } from '../flows/pendingAccountDeletion';

const isWorkspacePath = (path: string) => path === WORKSPACE_PATH || path.startsWith(`${WORKSPACE_PATH}/`);

/**
 * Enlaza el acceso con el router y aplica las reglas de sesión del prototipo:
 * - la portada, con la sesión lista, lleva al espacio (y se oculta mientras se resuelve);
 * - el espacio sin sesión vuelve a la portada, y con el alta a medias la abre.
 */
export function useAuthRouting(): void {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const { status, accountDeletionPending } = useSession();
  const busy = useAuthUi(flowActive);
  const amazonIntent = useAmazonIntent(state => state.pending);
  const promptedIntent = useRef<string | null>(null);

  useEffect(() => {
    const incoming = amazonIntentQuery(search);
    if (!incoming) return;
    rememberAmazonIntent(incoming.id);
    // Retirar el traspaso de la dirección; solo su ID opaco sobrevive al login.
    navigate(`${pathname}${incoming.search}${hash}`, { replace: true });
  }, [navigate, pathname, search, hash]);
  useEffect(() => {
    if (!amazonIntent) return;
    const timer = setTimeout(clearAmazonIntent, Math.max(0, amazonIntent.createdAt + AMAZON_INTENT_TTL - Date.now()));
    return () => clearTimeout(timer);
  }, [amazonIntent]);

  useLayoutEffect(() => {
    navigation.bind(navigate, pathname);
  }, [navigate, pathname]);
  useEffect(() => () => navigation.unbind(navigate), [navigate]);

  useEffect(() => {
    void bootAuth(search);
    // Solo al cargar la página: bootAuth se protege de repeticiones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const authReturn = isAuthReturn(search);
  useEffect(() => {
    if (accountDeletionPending && recoverPendingAccountDeletion()) return;
    if (status === 'loading' || busy || navigation.navigating() || amazonIntentQuery(search)) return;
    if (amazonIntent && status === 'ready' && pathname !== '/espacio/nexus') {
      navigate('/espacio/nexus', { replace: true });
      return;
    }
    if (isWorkspacePath(pathname)) {
      if (status === 'signed-out') navigate(HOME_PATH, { replace: true });
      else if (status === 'onboarding') showProfile();
    } else if (pathname === HOME_PATH && status === 'ready' && !authReturn) {
      navigate(WORKSPACE_PATH, { replace: true });
    } else if (pathname === HOME_PATH && status === 'signed-out' && amazonIntent && promptedIntent.current !== amazonIntent.id) {
      promptedIntent.current = amazonIntent.id;
      openSignInDialog();
    }
  }, [status, busy, pathname, search, authReturn, navigate, amazonIntent, accountDeletionPending]);

  // Prototipo: html.uon-resolving-home oculta la portada hasta saber si hay sesión.
  const resolving = pathname === HOME_PATH && !authReturn && (status === 'loading' || (status === 'ready' && !busy));
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('uon-resolving-home', resolving);
    return () => root.classList.remove('uon-resolving-home');
  }, [resolving]);
}
