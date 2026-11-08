import { DEFAULT_AR_SETTINGS, SCENE } from './constants';
import { utf8Base64 } from './format';
import type { ARSettings, ARTab, CameraPermission } from './types';

/**
 * Vista AR (prototipo: ARViewerModal de pim/modelos3d.js). El modal del original
 * siempre estaba montado: la pestaña activa, el permiso y los ajustes persisten
 * entre aperturas durante la carga de la página.
 */
export const arMemory: { activeTab: ARTab; cameraPermission: CameraPermission; arSettings: ARSettings } = {
  activeTab: 'qr',
  cameraPermission: 'pending',
  arSettings: { ...DEFAULT_AR_SETTINGS },
};

/** Recuerda la pestaña, el permiso o los ajustes para la próxima apertura. */
export function rememberAR(patch: Partial<typeof arMemory>): void {
  Object.assign(arMemory, patch);
}

export const AR_TABS: readonly { id: ARTab; icon: string; label: string }[] = [
  { id: 'qr', icon: 'm3d-qr', label: 'Código QR' },
  { id: 'camera', icon: 'camera', label: 'Cámara AR' },
  { id: 'preview', icon: 'm3d-monitor', label: 'Preview 3D' },
];

/** Pestaña siguiente con las flechas, Inicio y Fin (patrón de pestañas WAI-ARIA). */
export function nextARTab(current: ARTab, key: string): ARTab | null {
  const order = AR_TABS.map(tab => tab.id);
  const index = order.indexOf(current);
  if (key === 'Home') return order[0];
  if (key === 'End') return order[order.length - 1];
  if (key === 'ArrowRight') return order[(index + 1) % order.length];
  if (key === 'ArrowLeft') return order[(index - 1 + order.length) % order.length];
  return null;
}

/** Enlace de la experiencia AR (simulada) y la imagen de su código QR. */
export function arLinks(name: string, now: number = Date.now()): { arUrl: string; qrSrc: string } {
  const arUrl = `https://uonify.com/ar/${utf8Base64(name)}-${now}`;
  return { arUrl, qrSrc: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(arUrl)}` };
}

type Canvas2D = Pick<
  CanvasRenderingContext2D,
  'drawImage' | 'save' | 'restore' | 'translate' | 'rotate' | 'fillRect' | 'strokeRect' | 'createLinearGradient' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fillText'
> & { filter: string; fillStyle: CanvasRenderingContext2D['fillStyle']; strokeStyle: CanvasRenderingContext2D['strokeStyle']; lineWidth: number; font: string };

/**
 * Un fotograma de la «Vista AR Simulada»: la cámara, el mismo cubo azul de marca
 * que el visor (girando si «Auto-rotar»), cuadrícula, ejes y la ficha superior.
 */
export function drawARFrame(
  context: Canvas2D,
  video: CanvasImageSource | null,
  size: { width: number; height: number },
  settings: ARSettings,
  name: string,
  time: number,
): void {
  const { width, height } = size;
  if (video) {
    try { context.drawImage(video, 0, 0, width, height); } catch { /* sin fotograma */ }
  }
  const centerX = width / 2;
  const centerY = height / 2;
  context.save();
  const side = 60 * settings.scale;
  context.translate(centerX, centerY);
  context.rotate(settings.autoRotate ? time * 0.002 : 0);
  context.filter = `brightness(${settings.lightIntensity / 0.8})`;
  context.fillStyle = 'rgba(0, 0, 0, 0.2)';
  context.fillRect(-side / 2 + 5, -side / 2 + 5, side, side);
  const gradient = context.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2);
  gradient.addColorStop(0, SCENE.cube);
  gradient.addColorStop(1, SCENE.cubeGlow);
  context.fillStyle = gradient;
  context.fillRect(-side / 2, -side / 2, side, side);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;
  context.strokeRect(-side / 2, -side / 2, side, side);
  context.restore();
  if (settings.showGrid) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    context.lineWidth = 1;
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    };
    for (let x = 0; x < width; x += 40) line(x, 0, x, height);
    for (let y = 0; y < height; y += 40) line(0, y, width, y);
  }
  if (settings.showAxes) {
    context.lineWidth = 3;
    context.strokeStyle = '#ef4444';
    context.beginPath(); context.moveTo(centerX, centerY); context.lineTo(centerX + 50, centerY); context.stroke();
    context.strokeStyle = '#10b981';
    context.beginPath(); context.moveTo(centerX, centerY); context.lineTo(centerX, centerY - 50); context.stroke();
  }
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(10, 10, 200, 80);
  context.fillStyle = '#ffffff';
  context.font = '14px sans-serif';
  context.fillText(`📱 ${name}`, 20, 30);
  context.fillText('🎯 AR Activo', 20, 50);
  context.fillText(`📏 Escala: ${Math.round(settings.scale * 100)}%`, 20, 70);
}
