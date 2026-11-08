import { topLevelRoutes } from '@/app/routeRegistry';

test('los módulos registran sus rutas sin tocar el router', () => {
  expect(topLevelRoutes.some(route => route.path === '/')).toBe(true);
  expect(topLevelRoutes.some(route => route.id === 'workspace')).toBe(true);
});
