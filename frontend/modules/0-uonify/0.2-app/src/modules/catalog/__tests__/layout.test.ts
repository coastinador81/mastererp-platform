import {
  applyDrawer,
  defaultLayout,
  drawerToggleLabel,
  layoutForView,
  layoutOnNarrow,
  toggleFromHeader,
  toggleFromRail,
} from '../model/layout';
import { collectTabs } from '../model/tabRegistry';

// Puerto de tests/product-source-layout.test.cjs («wide screens pin the catalog
// beside the sheet») y de chat-panel-layout.test.cjs (botón del catálogo).

const closed = { open: false, pinned: false };

test('pantallas anchas fijan el catálogo junto a la ficha; las estrechas lo pliegan', () => {
  const layoutAt = (width: number) => {
    const state = defaultLayout(closed, width >= 1200);
    return state.open && state.pinned;
  };
  expect(layoutAt(1568)).toBe(true);
  expect(layoutAt(1200)).toBe(true);
  expect(layoutAt(1100)).toBe(false);
  expect(layoutAt(900)).toBe(false);
});

test('el botón de la cabecera pliega en un clic un catálogo abierto, también en una columna estrecha', () => {
  expect(toggleFromHeader({ open: true, pinned: true }, false)).toEqual(closed);
  expect(toggleFromHeader({ open: true, pinned: false }, true)).toEqual(closed);
  expect(toggleFromHeader({ open: true, pinned: false }, false)).toEqual({ open: true, pinned: true });
  expect(drawerToggleLabel({ open: true, pinned: true }, false)).toBe('Replegar catálogo');
  expect(drawerToggleLabel({ open: true, pinned: false }, true)).toBe('Replegar catálogo');
  expect(drawerToggleLabel({ open: true, pinned: false }, false)).toBe('Fijar catálogo');
  expect(drawerToggleLabel(closed, false)).toBe('Expandir y fijar catálogo');
});

test('el icono del raíl abre y deja fijado el catálogo (si cabe) o lo pliega', () => {
  expect(toggleFromRail(closed, false, true)).toEqual({ open: true, pinned: true });
  expect(toggleFromRail(closed, true, true)).toEqual({ open: true, pinned: false });
  expect(toggleFromRail({ open: true, pinned: true }, false, true)).toEqual(closed);
  expect(applyDrawer({ open: false, pinned: true }, true, true)).toEqual({ open: true, pinned: false });
});

test('entrar en Producto o cerrar una ficha abre el catálogo fijado; una ficha estrecha lo pliega', () => {
  expect(layoutForView(closed, { hasSheet: false, entering: true, leavingSheet: false, narrow: false })).toEqual({ open: true, pinned: true });
  expect(layoutForView(closed, { hasSheet: false, entering: false, leavingSheet: true, narrow: false })).toEqual({ open: true, pinned: true });
  expect(layoutForView(closed, { hasSheet: false, entering: true, leavingSheet: false, narrow: true })).toEqual(closed);
  expect(layoutForView({ open: true, pinned: true }, { hasSheet: true, entering: false, leavingSheet: false, narrow: true })).toEqual(closed);
  expect(layoutForView({ open: true, pinned: true }, { hasSheet: true, entering: false, leavingSheet: false, narrow: false })).toEqual({ open: true, pinned: true });
});

test('al estrecharse la columna el catálogo deja de estar fijado, salvo bajo quien escribe', () => {
  expect(layoutOnNarrow({ open: true, pinned: true }, false)).toEqual(closed);
  expect(layoutOnNarrow({ open: true, pinned: true }, true)).toEqual({ open: true, pinned: false });
  expect(layoutOnNarrow({ open: true, pinned: false }, false)).toEqual({ open: true, pinned: false });
});

test('las pestañas se reúnen de los módulos pim-* en el orden de la ficha', () => {
  const component = () => null;
  const tabs = collectTabs({
    '../pim-video/index.ts': { tab: { key: 'video', label: 'Vídeo', icon: 'video', component } },
    '../pim-atributos/index.ts': { atributosTab: { key: 'atributos', label: 'Atributos', icon: null, component }, other: 1 },
    '../pim-roto/index.ts': { tab: { key: 'otra', label: 'Otra', icon: null, component } },
  });
  expect(tabs.map(tab => tab.key)).toEqual(['atributos', 'video']);
});
