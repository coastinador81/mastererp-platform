import { newGuide, guideOf } from '../guide/store';
import { useCatalogStore } from '../hooks/useCatalogStore';

test('la salida de una cuenta retira guías y selección de productos también de la sesión', () => {
  newGuide('private-thread');
  useCatalogStore.getState().setSelection(['PRIVATE']);
  useCatalogStore.getState().setChannel('PRIVATE', 'Amazon', true);
  useCatalogStore.getState().setRedirect({ from: 'new', sku: 'PRIVATE' });
  expect(guideOf('private-thread')).toBeDefined();
  window.dispatchEvent(new CustomEvent('uonify:identity-changed', { detail: { email: null } }));
  expect(guideOf('private-thread')).toBeUndefined();
  expect(useCatalogStore.getState()).toMatchObject({ selection: [], channelStates: {}, redirect: null });
  expect(sessionStorage.getItem('uonify-product-guides-v1')).toBe('{}');
  expect(sessionStorage.getItem('uonify-catalog-channels-v1')).toBe('{}');
});
