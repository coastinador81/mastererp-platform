import type { RouteObject } from 'react-router';
export const routes: RouteObject[] = [{ path: '/ayuda', lazy: async () => ({ Component: (await import('./components/HelpPage')).HelpPage }) }, { path: '/ayuda/:slug', lazy: async () => ({ Component: (await import('./components/HelpPage')).HelpPage }) }];
