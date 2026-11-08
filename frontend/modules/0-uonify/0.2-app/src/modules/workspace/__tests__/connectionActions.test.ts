import { connectionActionsOf } from '../model/connectionActions';

it('limita la presentación a Amazon en respuestas del asistente sin conservar instrucciones externas', () => {
  const actions = [
    { provider: 'amazon', action: 'manage', url: 'https://untrusted.test', disconnect: true },
    { provider: 'amazon', action: 'manage' },
    { provider: 'amazon', action: 'disconnect' },
    { provider: 'google', action: 'manage' },
    'amazon', null,
  ];
  expect(connectionActionsOf(actions, 'assistant')).toEqual([{ provider: 'amazon', action: 'manage' }]);
  expect(connectionActionsOf(actions, 'user')).toBeUndefined();
  expect(connectionActionsOf(actions, 'system')).toBeUndefined();
  expect(connectionActionsOf({ provider: 'amazon', action: 'manage' }, 'assistant')).toBeUndefined();
  expect(connectionActionsOf([{ provider: 'amazon', action: 'disconnect' }], 'assistant')).toBeUndefined();
});

it('conserva solo proveedores operativos conocidos, una vez y sin órdenes ni URLs', () => {
  expect(connectionActionsOf([
    { provider: 'drive', action: 'manage', url: '/desconectar' },
    { provider: 'blender', action: 'manage' },
    { provider: 'cloud', action: 'manage' },
    { provider: 'amazon', action: 'manage' },
    { provider: 'drive', action: 'manage' },
    { provider: 'chatgpt', action: 'manage' },
    { provider: 'cloud', action: 'authorize' },
  ], 'assistant')).toEqual(['drive', 'blender', 'cloud', 'amazon'].map(provider => ({ provider, action: 'manage' })));
});

it('presenta la eliminación propia sin aceptar órdenes de borrado ni datos de otra cuenta', () => {
  expect(connectionActionsOf([
    { provider: 'account', action: 'manage', email: 'foreign@example.test', confirmation: 'ELIMINAR' },
    { provider: 'account', action: 'delete' },
    { provider: 'account', action: 'manage' },
  ], 'assistant')).toEqual([{ provider: 'account', action: 'manage' }]);
  expect(connectionActionsOf([{ provider: 'account', action: 'manage' }], 'user')).toBeUndefined();
});
