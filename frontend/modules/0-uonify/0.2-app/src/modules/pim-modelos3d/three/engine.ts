import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CAMERA_POSITIONS, GENERATED_MODEL, SCENE } from '../model/constants';
import type { CameraView, ViewerSettings } from '../model/types';
import { clearGroup, disposeTree, fitModel, transformedGroup } from './fitModel';
import { loadEnvironment, loadGLTF } from './loaders';
import { createAxes, createGrid, createPlaceholderCube, updateGrid, type GridMesh } from './sceneHelpers';

/**
 * Escena Three.js del visor (prototipo: buildScene, loadModelInto, applyWireframe,
 * applyEnvironment y disposeRenderer de pim/modelos3d.js; Model3DCanvas del
 * original). React pinta los controles; esta clase solo toca WebGL.
 */
export interface ViewerEngineOptions {
  /** Contenedor del canvas (lo llena la escena; React no pinta hijos en él). */
  host: HTMLElement;
  modelUrl: string;
  category: string;
  settings: ViewerSettings;
  /** Movimiento reducido: la animación del modelo se detiene. Se consulta en cada fotograma. */
  reducedMotion: () => boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const sizeOf = (box: HTMLElement) => ({ width: Math.max(1, box.clientWidth), height: Math.max(1, box.clientHeight) });

export class ViewerEngine {
  private readonly options: ViewerEngineOptions;
  private settings: ViewerSettings;
  private modelUrl: string;
  private disposed = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private ambient!: THREE.AmbientLight;
  private dir1!: THREE.DirectionalLight;
  private dir2!: THREE.DirectionalLight;
  private grid!: GridMesh;
  private axes!: THREE.Group;
  private readonly modelRoot = new THREE.Group();
  private spinner: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private loadToken = {};
  private envToken = {};
  private resizeObserver: ResizeObserver | null = null;
  private readonly timer = new THREE.Timer();

  constructor(options: ViewerEngineOptions) {
    this.options = options;
    this.settings = { ...options.settings };
    this.modelUrl = options.modelUrl;
    try {
      this.build();
    } catch (error) {
      // try/catch de SafeCanvas: si el renderer no se puede crear, se libera lo creado.
      this.dispose();
      throw error;
    }
  }

  private build(): void {
    const { host } = this.options;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(SCENE.clear, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = false;
    const canvas = renderer.domElement;
    canvas.className = 'pim-modelos3d-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Visor 3D');
    host.replaceChildren(canvas);
    const size = sizeOf(host);
    renderer.setSize(size.width, size.height, false);

    this.camera = new THREE.PerspectiveCamera(50, size.width / size.height, 0.1, 1000);
    this.camera.position.set(3, 2, 5);
    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1;
    controls.maxDistance = 10;
    controls.maxPolarAngle = Math.PI / 1.75;
    controls.autoRotate = this.settings.autoRotate;
    controls.autoRotateSpeed = 2;
    this.controls = controls;

    // Iluminación
    const intensity = this.settings.lightIntensity;
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5 * intensity);
    this.dir1 = new THREE.DirectionalLight(0xffffff, 1 * intensity);
    this.dir1.position.set(5, 5, 5);
    this.dir2 = new THREE.DirectionalLight(0xffffff, 0.4 * intensity);
    this.dir2.position.set(-5, 3, -5);
    this.scene.add(this.ambient, this.dir1, this.dir2);
    this.applyEnvironment();
    // Rejilla de referencia y ejes
    this.grid = createGrid();
    this.grid.visible = this.settings.showGrid;
    this.axes = createAxes();
    this.axes.visible = this.settings.showAxes;
    this.scene.add(this.grid, this.axes, this.modelRoot);
    this.loadModel();
    // Plano de sombras (sombras desactivadas, como el original)
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.2 }));
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.01;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);

    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(host);
    }
    // Con la pestaña del navegador oculta el reloj no avanza (sin saltos al volver).
    this.timer.connect(document);
    renderer.setAnimationLoop(this.frame);
  }

  private readonly frame = (time: number) => {
    const renderer = this.renderer;
    if (!renderer || !this.controls) return;
    this.timer.update(time);
    const delta = this.timer.getDelta();
    if (this.settings.autoRotate && this.spinner) this.spinner.rotation.y += delta * 0.5;
    // Animación del propio modelo en bucle; quieta con «reducir movimiento».
    if (this.mixer && !this.options.reducedMotion()) this.mixer.update(delta);
    this.controls.update();
    if (this.grid.visible) updateGrid(this.grid, this.camera);
    renderer.render(this.scene, this.camera);
  };

  private readonly onResize = () => {
    if (this.disposed || !this.renderer) return;
    const next = sizeOf(this.options.host);
    this.renderer.setSize(next.width, next.height, false);
    this.camera.aspect = next.width / next.height;
    this.camera.updateProjectionMatrix();
  };

  private readonly onLost = (event: Event) => {
    event.preventDefault();
    if (!this.disposed) this.options.onContextLost?.();
  };

  private readonly onRestored = () => {
    if (this.disposed) return;
    this.options.onContextRestored?.();
    try {
      this.renderer?.setClearColor(SCENE.clear, 0);
      this.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      /* silencioso, como el original */
    }
  };

  private applyEnvironment(): void {
    const token = {};
    this.envToken = token;
    loadEnvironment(this.settings.environmentPreset).then(texture => {
      if (!this.disposed && this.envToken === token) this.scene.environment = texture;
    }, () => { /* sin HDR: queda la luz directa */ });
  }

  /** E16: «Wireframe» se aplica a los materiales del modelo (no a los decorativos). */
  private applyWireframe(): void {
    this.modelRoot.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.m3dFixed) return;
      ([] as THREE.Material[]).concat(mesh.material ?? []).forEach(material => {
        if (material && 'wireframe' in material) (material as THREE.MeshStandardMaterial).wireframe = this.settings.showWireframe;
      });
    });
  }

  private placeGroup(children: THREE.Object3D[]): void {
    const group = transformedGroup(this.options.category);
    group.add(...children);
    this.modelRoot.add(group);
    this.spinner = group;
    this.applyWireframe();
  }

  private loadModel(): void {
    clearGroup(this.modelRoot);
    this.spinner = null;
    const token = {};
    this.loadToken = token;
    this.mixer?.stopAllAction();
    this.mixer = null;
    const url = this.modelUrl;
    if (!url || url === GENERATED_MODEL) {
      this.placeGroup(createPlaceholderCube());
      return;
    }
    // <Model> con Suspense: cubo wireframe mientras carga (Loading3D)
    const loading = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: SCENE.cube, wireframe: true }));
    loading.userData.m3dFixed = true;
    this.modelRoot.add(new THREE.Group().add(loading));
    loadGLTF(url).then(gltf => {
      if (this.disposed || this.loadToken !== token) return;
      clearGroup(this.modelRoot);
      const model = gltf.scene.clone();
      // Animación del propio modelo (p. ej. la torre que se monta y se desmonta), en bucle.
      const clip = gltf.animations?.[0];
      this.mixer = clip ? new THREE.AnimationMixer(model) : null;
      if (this.mixer && clip) this.mixer.clipAction(clip).play();
      this.placeGroup([fitModel(model, this.mixer, clip?.duration || 0)]);
    }, () => {
      if (this.disposed || this.loadToken !== token) return;
      // A03: un archivo que no es glTF/GLB pinta el cubo de reserva de <Model>.
      clearGroup(this.modelRoot);
      this.placeGroup([new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: SCENE.cube, metalness: 0.3, roughness: 0.4 }))]);
    });
  }

  setModel(url: string): void {
    if (this.disposed || url === this.modelUrl) return;
    this.modelUrl = url;
    this.loadModel();
  }

  setSettings(next: ViewerSettings): void {
    if (this.disposed) return;
    const previous = this.settings;
    this.settings = { ...next };
    this.grid.visible = next.showGrid;
    this.axes.visible = next.showAxes;
    if (this.controls) this.controls.autoRotate = next.autoRotate;
    if (previous.showWireframe !== next.showWireframe) this.applyWireframe();
    if (previous.lightIntensity !== next.lightIntensity) {
      this.ambient.intensity = 0.5 * next.lightIntensity;
      this.dir1.intensity = 1 * next.lightIntensity;
      this.dir2.intensity = 0.4 * next.lightIntensity;
    }
    if (previous.environmentPreset !== next.environmentPreset) this.applyEnvironment();
  }

  /** «Vistas de Cámara»; false si aún no hay controles. */
  setCameraView(view: CameraView): boolean {
    const controls = this.controls;
    if (!controls) return false;
    controls.object.position.set(...CAMERA_POSITIONS[view]);
    controls.target.set(0, 0, 0);
    controls.update();
    return true;
  }

  resetCamera(): void {
    this.controls?.reset();
  }

  /** Captura PNG: pinta el fotograma justo antes de leerlo (E12). */
  capture(): string | null {
    if (!this.renderer) return null;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    this.timer.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.mixer?.stopAllAction();
    this.mixer = null;
    const renderer = this.renderer;
    if (renderer) {
      const canvas = renderer.domElement;
      renderer.setAnimationLoop(null);
      canvas.removeEventListener('webglcontextlost', this.onLost);
      canvas.removeEventListener('webglcontextrestored', this.onRestored);
      try { this.controls?.dispose(); } catch { /* silencioso */ }
      try { disposeTree(this.scene); } catch { /* silencioso */ }
      try {
        renderer.dispose();
        renderer.forceContextLoss();
      } catch {
        /* silencioso */
      }
      canvas.remove();
      this.renderer = null;
    }
    this.controls = null;
  }
}

export function createViewerEngine(options: ViewerEngineOptions): ViewerEngine {
  return new ViewerEngine(options);
}
