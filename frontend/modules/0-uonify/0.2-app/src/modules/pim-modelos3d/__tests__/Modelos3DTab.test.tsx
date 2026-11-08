import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pimStore } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { Model3DService } from '../api/model3dService';
import { tab } from '../index';
import { renderTab, SAMPLE_FILES, silenceCanvas } from './testUtils';

beforeEach(() => {
  pimStore.clear();
  silenceCanvas();
});
afterEach(() => vi.restoreAllMocks());

describe('pestaña «3D»', () => {
  test('se registra como la pestaña modelos3d con la etiqueta «3D»', () => {
    expect(tab).toMatchObject({ key: 'modelos3d', label: '3D', icon: 'package' });
  });

  test('estado vacío: acciones, fuente de imágenes y notas; sin selector de categoría', () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 2, name: 'Modelos 3D' })).toBeInTheDocument();
    expect(screen.getByText('0 modelos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Genera Modelos 3D con Uony' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar Modelo 3D' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir Modelo' })).toBeEnabled();
    expect(screen.getByText('Agrega imágenes en la pestaña "Imágenes"')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Fuente de Imágenes' })).toBeInTheDocument();
    expect(screen.getByText('Formatos Soportados')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Generación avanzada con Uony/ })).toBeInTheDocument();
    expect(screen.getByText(/Uony, la IA de Uonify/)).toBeInTheDocument();
    // Retirado por el dueño (25-09-2026).
    expect(screen.queryByText(/Categoría del Producto/)).not.toBeInTheDocument();
  });

  test('la galería de Imágenes habilita «Generar»; «Subir Nuevas» pide archivos', async () => {
    pimStore.set('UON-KIT-01', 'images', [{ id: 'a', url: '/a.jpg' }, { id: 'b', url: '/b.jpg' }]);
    renderTab();
    const gallery = screen.getByRole('button', { name: /Galería/ });
    expect(gallery).toHaveAttribute('aria-pressed', 'true');
    expect(gallery).toHaveTextContent('2 imágenes');
    expect(screen.getByRole('button', { name: 'Generar Modelo 3D' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /Subir Nuevas/ }));
    expect(screen.getByRole('button', { name: /Subir Nuevas/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Subir Nuevas')).toHaveAttribute('type', 'file');
    expect(screen.getByText('Selecciona imágenes para generar el modelo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar Modelo 3D' })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText('Subir Nuevas'), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    expect(screen.getByRole('button', { name: /Subir Nuevas/ })).toHaveTextContent('1 imágenes');
    expect(screen.getByRole('button', { name: 'Generar Modelo 3D' })).toBeEnabled();
  });

  test('modelos del producto: lista, selección, metadatos y borrado local', async () => {
    const success = vi.spyOn(toast, 'success');
    pimStore.set('UON-KIT-01', 'model3d', { selected3DModel: SAMPLE_FILES[0].url, selectedKey: SAMPLE_FILES[0].key, files: SAMPLE_FILES });
    renderTab();
    expect(screen.getByRole('heading', { name: 'Imágenes Generadas (3)' })).toBeInTheDocument();
    expect(screen.getByText('1 modelo')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveClass('is-selected');
    expect(within(rows[0]).getByText('2.04 MB')).toBeInTheDocument();
    expect(screen.getByText('~9.7k')).toBeInTheDocument();
    expect(screen.getByText('Sin compresión')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar GLB' })).toHaveClass('pim-btn-primary');
    expect(screen.getByRole('button', { name: 'Vista AR' })).toHaveClass('pim-btn-outline');

    await userEvent.click(within(rows[1]).getByRole('button', { name: /^tres-personajes\.glb/ }));
    expect(success).toHaveBeenCalledWith('Modelo 3D cargado');
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ selected3DModel: SAMPLE_FILES[1].url, selectedKey: SAMPLE_FILES[1].key });

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar tres-personajes.glb' }));
    expect(success).toHaveBeenCalledWith('Modelo eliminado');
    expect(screen.getByRole('heading', { name: 'Imágenes Generadas (2)' })).toBeInTheDocument();
    expect(pimStore.get<{ files: unknown[]; selected3DModel: unknown }>('UON-KIT-01', 'model3d')).toMatchObject({ selected3DModel: null });
    expect(pimStore.get<{ files: unknown[] }>('UON-KIT-01', 'model3d').files).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Descargar GLB' })).toHaveClass('pim-btn-outline');
  });

  test('«Eliminar modelo 3D» cierra el visor y «Eliminar todos» vacía la lista', async () => {
    const success = vi.spyOn(toast, 'success');
    pimStore.set('UON-KIT-01', 'model3d', { selected3DModel: SAMPLE_FILES[0].url, files: SAMPLE_FILES });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar modelo 3D' }));
    expect(success).toHaveBeenCalledWith('🗑️ Modelo 3D eliminado');
    expect(screen.getByText('0 modelos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar todos' }));
    expect(success).toHaveBeenCalledWith('Todos los modelos eliminados');
    expect(screen.getByRole('heading', { name: 'Genera Modelos 3D con Uony' })).toBeInTheDocument();
    expect(pimStore.get<{ files: unknown[] }>('UON-KIT-01', 'model3d').files).toEqual([]);
  });

  test('al montar descarta una blob: URL de otra carga de la página', () => {
    pimStore.set('UON-KIT-01', 'model3d', { selected3DModel: 'blob:http://localhost/antigua', isGenerating3D: true, generation3DProgress: 30 });
    renderTab();
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ selected3DModel: null, isGenerating3D: false, generation3DProgress: 0 });
    expect(screen.getByText('0 modelos')).toBeInTheDocument();
  });

  test('con un upload_id guardado carga la lista del servidor y abre el primero', async () => {
    const success = vi.spyOn(toast, 'success');
    const list = vi.spyOn(Model3DService, 'listModelsByUploadId').mockResolvedValue([
      { key: 'output/upl_1/caja.glb', url: '/assets/caja.glb', size: 1048576, type: 'model/gltf-binary', metadata: { polygons: 1212 } },
    ]);
    pimStore.set('UON-KIT-01', 'model3d', { uploadId: 'upl_1' });
    renderTab();
    await waitFor(() => expect(success).toHaveBeenCalledWith('Modelo 3D cargado automáticamente'));
    expect(list).toHaveBeenCalledWith('upl_1');
    expect(screen.getByRole('heading', { name: 'Imágenes Generadas (1)' })).toBeInTheDocument();
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ selected3DModel: '/assets/caja.glb', selectedKey: 'output/upl_1/caja.glb' });
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  test('la generación en curso se ve en la pestaña y «Cancelar» la detiene', async () => {
    const info = vi.spyOn(toast, 'info');
    pimStore.set('UON-KIT-01', 'model3d', { isGenerating3D: true, generation3DProgress: 45 });
    renderTab();
    // Sin generación viva en esta carga, el montaje la da por terminada (como el original).
    expect(screen.queryByText('Generando Modelo 3D con Uony')).not.toBeInTheDocument();
    act(() => { pimStore.set('UON-KIT-01', 'model3d', { isGenerating3D: true, generation3DProgress: 60 }); });
    expect(screen.getByRole('heading', { name: 'Generando Modelo 3D con Uony' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Generando Modelo 3D con Uony' })).toHaveAttribute('aria-valuenow', '60');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(info).toHaveBeenCalledWith('❌ Generación 3D cancelada');
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ isGenerating3D: false, generation3DProgress: 0 });
  });
});
