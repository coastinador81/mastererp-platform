import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { pimStore } from '@/shared/pim';
import { toast } from '@/shared/ui';
import { Model3DService } from '../api/model3dService';
import { arMemory } from '../model/ar';
import { renderTab, SAMPLE_FILES, silenceCanvas } from './testUtils';

const originalCreateObjectURL = URL.createObjectURL;
beforeEach(() => {
  pimStore.clear();
  silenceCanvas();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(URL, { createObjectURL: originalCreateObjectURL });
});

describe('«Generar Modelo 3D con Uony»', () => {
  test('configura, genera en 9 pasos y abre el modelo en el visor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const success = vi.spyOn(toast, 'success');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    pimStore.set('UON-KIT-01', 'images', [{ id: 'a', url: '/a.jpg', name: 'Torre' }, { id: 'b', url: '/b.jpg' }]);
    renderTab();
    await user.click(screen.getByRole('button', { name: 'Generar Modelo 3D' }));
    const dialog = screen.getByRole('dialog', { name: 'Generar Modelo 3D con Uony' });
    expect(dialog).toHaveTextContent('Genera un modelo 3D desde 2 imágenes (de galería)');
    expect(within(dialog).getByRole('img', { name: 'Torre' })).toHaveAttribute('src', '/a.jpg');
    expect(within(dialog).getByText('~60s')).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Calidad de Generación'), 'draft');
    expect(within(dialog).getByText('~30s')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /Mostrar Configuración Avanzada/ }));
    const pbr = within(dialog).getByRole('switch', { name: 'Materiales PBR' });
    expect(pbr).toHaveAttribute('aria-checked', 'true');

    await user.click(within(dialog).getByRole('button', { name: 'Generar Modelo 3D' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500 * 3); });
    expect(within(dialog).getByRole('progressbar', { name: 'Progreso' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Generando Modelo 3D con Uony' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(500 * 7); });

    expect(success).toHaveBeenCalledWith('✅ ¡Modelo 3D generado con éxito!', { description: expect.stringMatching(/triángulos • Texturas 2048px$/) });
    expect(success).toHaveBeenCalledWith('✅ Modelo 3D generado correctamente');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ selected3DModel: 'generated', isGenerating3D: false, generation3DProgress: 0 });
    expect(screen.getByText('1 modelo')).toBeInTheDocument();
  });

  test('con un upload_id guardado consulta los resultados del servidor', async () => {
    const info = vi.spyOn(toast, 'info');
    const list = vi.spyOn(Model3DService, 'listModelsByUploadId')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ key: 'output/upl_9/modelo.glb', url: '/assets/modelo.glb', size: 1048576 }]);
    pimStore.set('UON-KIT-01', 'images', [{ id: 'a', url: '/a.jpg' }]);
    pimStore.set('UON-KIT-01', 'model3d', { uploadId: 'upl_9' });
    renderTab();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Generar Modelo 3D' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Procesamiento en Curso')).toBeInTheDocument();
    expect(within(dialog).getByText('upl_9')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Consultar Resultados' }));
    await waitFor(() => expect(info).toHaveBeenCalledWith('⏳ Aún procesando', expect.objectContaining({ duration: 5000 })));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Consultar Resultados' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: /modelo\.glb/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usar Modelo Seleccionado' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ selected3DModel: '/assets/modelo.glb', selectedKey: 'output/upl_9/modelo.glb' });
  });
});

describe('«Cargar Modelo 3D»', () => {
  test('rechaza un formato no soportado y deja reintentar', async () => {
    const error = vi.spyOn(toast, 'error');
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Subir Modelo' }));
    const dialog = screen.getByRole('dialog', { name: 'Cargar Modelo 3D' });
    expect(within(dialog).getByRole('button', { name: 'Seleccionar Archivo' })).toHaveFocus();
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'pieza.obj')] } });
    expect(await within(dialog).findByText('Error al validar modelo')).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith('❌ Formato no soportado. Use GLB o glTF.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Intentar de nuevo' }));
    expect(within(dialog).getByText('Arrastra tu modelo 3D aquí')).toBeInTheDocument();
  });

  test('analiza, sube con el upload_id y abre el archivo en el visor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:uonify/caja') });
    const upload = vi.spyOn(Model3DService, 'upload3DModel').mockResolvedValue({ upload_id: 'upl_new', filename: 'caja.glb', size: 4 });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Subir Modelo' }));
    const dialog = screen.getByRole('dialog', { name: 'Cargar Modelo 3D' });
    const glb = new File([new Uint8Array([1, 2, 3, 4])], 'caja.glb', { type: 'model/gltf-binary' });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [glb] } });
    expect(within(dialog).getByText('Analizando modelo...')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(150 * 10); });
    expect(upload).toHaveBeenCalledWith(glb, undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(pimStore.get('UON-KIT-01', 'model3d')).toMatchObject({ uploadId: 'upl_new', selected3DModel: 'blob:uonify/caja', selectedKey: null });
  });
});

describe('Vista AR', () => {
  test('solo se cierra con la X; pestañas con teclado y memoria entre aperturas', async () => {
    const success = vi.spyOn(toast, 'success');
    arMemory.activeTab = 'qr';
    pimStore.set('UON-KIT-01', 'model3d', { selected3DModel: SAMPLE_FILES[0].url, files: SAMPLE_FILES });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Vista AR' }));
    expect(success).toHaveBeenCalledWith('🚀 Abriendo Vista AR', { description: 'Preparando experiencia de realidad aumentada' });
    const dialog = screen.getByRole('dialog', { name: 'Vista AR - Make It Possible' });
    expect(within(dialog).getByRole('img', { name: 'QR Code AR' }).getAttribute('src')).toMatch(/^https:\/\/api\.qrserver\.com\//);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const qrTab = within(dialog).getByRole('tab', { name: 'Código QR' });
    qrTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    const cameraTab = within(dialog).getByRole('tab', { name: 'Cámara AR' });
    expect(cameraTab).toHaveAttribute('aria-selected', 'true');
    expect(cameraTab).toHaveFocus();
    expect(within(dialog).getByText('Necesitamos acceso a tu cámara para AR')).toBeVisible();
    expect(within(dialog).getByText('Escala: 100%')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vista AR' }));
    expect(screen.getByRole('tab', { name: 'Cámara AR' })).toHaveAttribute('aria-selected', 'true');
  });
});
