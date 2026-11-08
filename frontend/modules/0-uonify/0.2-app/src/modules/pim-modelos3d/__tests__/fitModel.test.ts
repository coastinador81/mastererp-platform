import * as THREE from 'three';
import { FIT_HEIGHT, FIT_WIDTH } from '../model/constants';
import { clearGroup, fitModel, modelTransform, transformedGroup } from '../three/fitModel';

const boxOf = (object: THREE.Object3D) => {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
};

const mesh = (width: number, height: number, depth: number, position: [number, number, number] = [0, 0, 0]) => {
  const item = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  item.position.set(...position);
  return item;
};

describe('encuadre del modelo (fitModel)', () => {
  test('un GLB en milímetros y descentrado queda centrado, apoyado en el suelo y dentro del encuadre', () => {
    const model = new THREE.Group().add(mesh(1000, 300, 200, [5000, 2000, -800]));
    const box = boxOf(fitModel(model));
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(FIT_WIDTH, 5);
    expect(size.y).toBeLessThanOrEqual(FIT_HEIGHT + 1e-6);
    expect(box.min.y).toBeCloseTo(0, 5);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
  });

  test('un modelo alto se limita por la altura (1,9)', () => {
    const box = boxOf(fitModel(new THREE.Group().add(mesh(1, 10, 1))));
    expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(FIT_HEIGHT, 5);
  });

  test('un modelo vacío no se toca', () => {
    const empty = new THREE.Group();
    expect(fitModel(empty).scale.x).toBe(1);
  });

  test('con animación, el encuadre abarca todo el recorrido', () => {
    const piece = mesh(1, 1, 1);
    piece.name = 'pieza';
    const model = new THREE.Group().add(piece);
    const track = new THREE.VectorKeyframeTrack('pieza.position', [0, 1, 2], [0, 0, 0, 10, 0, 0, 0, 0, 0]);
    const clip = new THREE.AnimationClip('montaje', 2, [track]);
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    fitModel(model, mixer, clip.duration);
    // Recorrido de x: de -0,5 a 10,5 (11 unidades) → escala 5,5 / 11.
    expect(model.scale.x).toBeCloseTo(FIT_WIDTH / 11, 1);
  });
});

describe('orientación por categoría', () => {
  test('suelo por defecto; pared y techo giran el modelo', () => {
    expect(modelTransform('floor')).toEqual({ rotation: [0, 0, 0], position: [0, 0, 0], scale: 1 });
    expect(modelTransform('wall').position).toEqual([0, 1, 0]);
    const group = transformedGroup('ceiling');
    expect(group.rotation.x).toBeCloseTo(Math.PI);
    expect(group.position.y).toBe(2);
  });

  test('clearGroup vacía y libera', () => {
    const group = new THREE.Group();
    const child = mesh(1, 1, 1);
    const dispose = vi.spyOn(child.geometry, 'dispose');
    group.add(child);
    clearGroup(group);
    expect(group.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalled();
  });
});
