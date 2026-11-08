import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { DRACO_PATH, HDRI, HDRI_ROOT } from '../model/constants';
import type { EnvPreset } from '../model/types';

/**
 * Cargas con caché (prototipo: loadGLTF y loadEnvironment de pim/modelos3d.js;
 * useLoader del original: una carga por URL). three viene del paquete instalado.
 */

const gltfCache = new Map<string, Promise<GLTF>>();
const envCache = new Map<EnvPreset, Promise<THREE.Texture>>();

export function loadGLTF(url: string): Promise<GLTF> {
  let promise = gltfCache.get(url);
  if (!promise) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    loader.setDRACOLoader(draco);
    promise = loader.loadAsync(url).finally(() => draco.dispose());
    promise.catch(() => gltfCache.delete(url));
    gltfCache.set(url, promise);
  }
  return promise;
}

/** HDR del preset de iluminación (sin HDR queda la luz directa). */
export function loadEnvironment(preset: EnvPreset): Promise<THREE.Texture> {
  let promise = envCache.get(preset);
  if (!promise) {
    promise = new HDRLoader().loadAsync(HDRI_ROOT + HDRI[preset]).then(texture => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      return texture;
    });
    promise.catch(() => envCache.delete(preset));
    envCache.set(preset, promise);
  }
  return promise;
}
