import * as THREE from 'three';
import { DEFAULT_VIEWER_SETTINGS } from '../model/constants';
import { createViewerEngine } from '../three/engine';
import { loadGLTF } from '../three/loaders';

// jsdom no tiene WebGL: un renderer de mentira que guarda el bucle y cuenta los fotogramas.
const renderers: FakeRenderer[] = [];
class FakeRenderer {
  domElement = document.createElement('canvas');
  shadowMap = { enabled: true };
  outputColorSpace = '';
  toneMapping = 0;
  loop: ((time: number) => void) | null = null;
  renders = 0;
  disposed = false;
  constructor() { renderers.push(this); }
  setPixelRatio() {}
  setClearColor() {}
  setSize() {}
  setAnimationLoop(loop: ((time: number) => void) | null) { this.loop = loop; }
  render() { this.renders += 1; }
  dispose() { this.disposed = true; }
  forceContextLoss() {}
}

vi.mock('three', async importOriginal => ({ ...(await importOriginal<typeof import('three')>()), WebGLRenderer: vi.fn(function WebGLRenderer() { return new FakeRenderer(); }) }));
vi.mock('../three/loaders', () => ({
  loadEnvironment: vi.fn(() => Promise.resolve(new THREE.Texture())),
  loadGLTF: vi.fn(),
}));

/** GLB de mentira: una pieza de 1000 unidades que se desplaza 10 en x y vuelve. */
function fakeGltf() {
  const piece = new THREE.Mesh(new THREE.BoxGeometry(1000, 100, 100), new THREE.MeshStandardMaterial());
  piece.name = 'pieza';
  const scene = new THREE.Group().add(piece);
  const clip = new THREE.AnimationClip('montaje', 2, [new THREE.VectorKeyframeTrack('pieza.position', [0, 1, 2], [0, 0, 0, 10, 0, 0, 0, 0, 0])]);
  return { scene, animations: [clip] };
}

type Inspectable = { modelRoot: THREE.Group; grid: THREE.Object3D; axes: THREE.Object3D; ambient: THREE.Light; camera: THREE.Camera; spinner: THREE.Object3D | null };
const inside = (engine: unknown) => engine as Inspectable;
const firstMesh = (root: THREE.Object3D) => {
  let found: THREE.Mesh | null = null;
  root.traverse(child => { if (!found && (child as THREE.Mesh).isMesh && !child.userData.m3dFixed) found = child as THREE.Mesh; });
  return found as unknown as THREE.Mesh;
};

function setup(modelUrl: string, reduced = false) {
  const host = document.createElement('div');
  const engine = createViewerEngine({ host, modelUrl, category: 'floor', settings: { ...DEFAULT_VIEWER_SETTINGS }, reducedMotion: () => reduced });
  return { host, engine, renderer: renderers.at(-1) as FakeRenderer };
}

afterEach(() => { renderers.length = 0; });

describe('escena del visor (ViewerEngine)', () => {
  test('crea el canvas accesible y pinta en bucle; al cerrar lo libera', () => {
    const { host, engine, renderer } = setup('generated');
    const canvas = host.querySelector('canvas');
    expect(canvas).toHaveClass('pim-modelos3d-canvas');
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas).toHaveAttribute('aria-label', 'Visor 3D');
    renderer.loop?.(performance.now());
    expect(renderer.renders).toBe(1);
    engine.dispose();
    expect(renderer.loop).toBeNull();
    expect(renderer.disposed).toBe(true);
    expect(host.querySelector('canvas')).toBeNull();
  });

  test('el modelo simulado es el cubo azul y los controles cambian la escena', () => {
    const { engine } = setup('generated');
    const scene = inside(engine);
    expect(firstMesh(scene.modelRoot).material).toMatchObject({ wireframe: false });
    engine.setSettings({ ...DEFAULT_VIEWER_SETTINGS, showGrid: false, showAxes: true, showWireframe: true, lightIntensity: 2 });
    expect(scene.grid.visible).toBe(false);
    expect(scene.axes.visible).toBe(true);
    expect(scene.ambient.intensity).toBe(1);
    expect(firstMesh(scene.modelRoot).material).toMatchObject({ wireframe: true });
    expect(engine.setCameraView('top')).toBe(true);
    // OrbitControls evita el polo exacto: la cámara queda casi en (0, 5, 0).
    scene.camera.position.toArray().forEach((value, index) => expect(value).toBeCloseTo([0, 5, 0][index], 4));
    engine.dispose();
    expect(engine.setCameraView('front')).toBe(false);
  });

  test('un GLB se encuadra y su animación corre; quieta con «reducir movimiento»', async () => {
    vi.mocked(loadGLTF).mockResolvedValue(fakeGltf() as never);
    for (const reduced of [false, true]) {
      const { engine, renderer } = setup('/assets/torre.glb', reduced);
      await Promise.resolve();
      await Promise.resolve();
      const piece = firstMesh(inside(engine).modelRoot);
      expect(piece.name).toBe('pieza');
      expect(inside(engine).spinner).not.toBeNull();
      const start = performance.now();
      renderer.loop?.(start);
      renderer.loop?.(start + 500);
      expect(piece.position.x !== 0).toBe(!reduced);
      engine.dispose();
    }
  });

  test('un archivo que no es glTF pinta el cubo de reserva (A03)', async () => {
    vi.mocked(loadGLTF).mockRejectedValue(new Error('no es glTF'));
    const { engine } = setup('/assets/roto.txt');
    await Promise.resolve();
    await Promise.resolve();
    const cube = firstMesh(inside(engine).modelRoot);
    expect((cube.geometry as THREE.BoxGeometry).parameters.width).toBe(1);
    engine.dispose();
  });
});
