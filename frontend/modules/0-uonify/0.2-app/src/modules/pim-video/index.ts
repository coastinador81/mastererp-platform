/**
 * Módulo pim-video: pestaña «Vídeo» de la ficha de producto (prototipo: pim/video.js
 * y pim/video.css). Puerta única del módulo: el módulo catalog importa `tab`.
 *
 * Porciones del almacén del producto: `video`, `videoStudio`, `videoView`, `productInfo`.
 * Servidor (simulado con MSW en mocks/handlers.ts): /billing/balance, /video/plans,
 * /video/projects, /video/projects/{id}/shots/{plano}/retry, /uploads, /amazon/ads/assets.
 */
import './styles/index.css';
import type { PimTabDefinition } from '@/shared/pim';
import { VideoTab } from './components/VideoTab';

export const tab: PimTabDefinition = { key: 'video', label: 'Vídeo', icon: 'video', component: VideoTab };
/** Alias con nombre propio (mismo objeto que `tab`). */
export const videoTab = tab;

// Lógica pura, por si otro módulo la necesita (p. ej. la revisión de «Publicar»).
export { requirements } from './model/requirements';
export { resultLine, fallbackLine } from './model/project';
export type { VideoItem, VideoLibrary, StudioState, Plan, Project } from './model/types';
