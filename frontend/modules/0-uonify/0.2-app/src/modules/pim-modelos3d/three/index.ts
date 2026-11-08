/**
 * Entrada diferida de la parte Three.js de la pestaña «3D»: se importa con
 * `import('../three')` al montar el visor, descargar el cubo o abrir la Vista AR,
 * para que three no pese en la carga inicial (el prototipo lo traía al usarse).
 */
export { createViewerEngine, type ViewerEngine, type ViewerEngineOptions } from './engine';
export { generatedModelURL } from './generatedModel';
