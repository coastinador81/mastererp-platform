import * as THREE from 'three';
import { FIT_HEIGHT, FIT_WIDTH } from '../model/constants';
import type { Model3DCategory } from '../model/types';

/**
 * Colocación del modelo en la escena (prototipo: modelTransform, fitModel,
 * disposeTree y clearGroup de pim/modelos3d.js).
 */

export interface ModelTransform {
  rotation: [number, number, number];
  position: [number, number, number];
  scale: number;
}

/** Model3DCanvas getModelTransform (orientación por categoría). */
export function modelTransform(category: Model3DCategory | string): ModelTransform {
  switch (category) {
    case 'wall': return { rotation: [0, Math.PI / 2, 0], position: [0, 1, 0], scale: 1 };
    case 'ceiling': return { rotation: [Math.PI, 0, 0], position: [0, 2, 0], scale: 1 };
    case 'glasses': return { rotation: [0, 0, 0], position: [0, 1.6, 0], scale: 1 };
    case 'footwear': return { rotation: [0, Math.PI / 4, 0], position: [0, 0, 0], scale: 1 };
    case 'mirror': return { rotation: [0, 0, 0], position: [0, 0.5, 0], scale: 1 };
    default: return { rotation: [0, 0, 0], position: [0, 0, 0], scale: 1 };
  }
}

export function transformedGroup(category: Model3DCategory | string): THREE.Group {
  const transform = modelTransform(category);
  const group = new THREE.Group();
  group.rotation.set(...transform.rotation);
  group.position.set(...transform.position);
  group.scale.setScalar(transform.scale);
  return group;
}

/**
 * Encuadre: un modelo que no viene centrado ni a escala (p. ej. un GLB en
 * milímetros) saldría enorme o fuera de cámara. Se centra, se apoya en el suelo
 * y se escala para caber en el encuadre de la cámara inicial (5,5 × 1,9). Si
 * trae animación, el encuadre abarca todo su recorrido (16 muestras).
 */
export function fitModel<T extends THREE.Object3D>(model: T, mixer: THREE.AnimationMixer | null = null, duration = 0): T {
  const box = new THREE.Box3();
  const samples = mixer && duration > 0 ? 16 : 1;
  for (let index = 0; index < samples; index += 1) {
    if (mixer) mixer.setTime((duration * index) / samples);
    model.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(model));
  }
  if (mixer) mixer.setTime(0);
  const size = box.getSize(new THREE.Vector3());
  const wide = Math.max(size.x, size.z);
  if (box.isEmpty() || !Number.isFinite(wide) || wide <= 0) return model;
  const scale = Math.min(FIT_WIDTH / wide, size.y > 0 ? FIT_HEIGHT / size.y : Infinity);
  const center = box.getCenter(new THREE.Vector3());
  model.scale.multiplyScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  return model;
}

type Disposable = { dispose?: () => void };

/** Libera geometrías y materiales de un árbol de objetos. */
export function disposeTree(object: THREE.Object3D): void {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    (mesh.geometry as Disposable | undefined)?.dispose?.();
    ([] as Disposable[]).concat((mesh.material as Disposable | Disposable[] | undefined) ?? []).forEach(material => material?.dispose?.());
  });
}

export function clearGroup(group: THREE.Object3D): void {
  [...group.children].forEach(child => {
    group.remove(child);
    disposeTree(child);
  });
}
