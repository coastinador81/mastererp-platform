import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SCENE } from '../model/constants';
import { trackBlobURL } from '../model/pageState';

/**
 * El modelo simulado 'generated' es el cubo de EmptyModel: su GLB sirve para
 * «Descargar GLB» y para el <model-viewer> de la Vista AR (E23, E52).
 */
let generated: Promise<string> | null = null;

export function generatedModelURL(): Promise<string> {
  if (!generated) {
    generated = (async () => {
      const scene = new THREE.Scene();
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: SCENE.cube, metalness: 0.3, roughness: 0.4, emissive: SCENE.cubeGlow, emissiveIntensity: 0.2 }),
      );
      cube.position.set(0, 0.5, 0);
      scene.add(cube);
      const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
      return trackBlobURL(URL.createObjectURL(new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' })));
    })().catch(error => {
      generated = null;
      throw error;
    });
  }
  return generated;
}
