export const operationsModule = 'erp.operations';

export const routePermissions = Object.freeze({
  summary: null,
  orders: 'operations.orders.read',
  preparation: 'operations.preparation.read',
  routes: 'operations.routes.read',
  nodes: 'operations.nodes.read',
  products: 'catalog.products.read',
  categories: 'catalog.categories.read',
  attributes: 'catalog.attributes.read',
  brands: 'catalog.brands.read',
  suppliers: 'catalog.suppliers.read',
  inventory: 'catalog.inventory.read',
});

const catalogRoutes = new Set(['products','categories','attributes','brands','suppliers','inventory']);

export function canOpenOperationsRoute(context, route) {
  if(route==='summary')return Boolean(context?.modules?.some(module=>[operationsModule,'erp.catalog'].includes(module)));
  const module=catalogRoutes.has(route)?'erp.catalog':operationsModule;
  return Boolean(
    context?.modules?.includes(module)
    && context?.permissions?.includes(routePermissions[route]),
  );
}
