import * as THREE from 'three';
import { SCENE } from '../model/constants';

/**
 * Rejilla y ejes de la escena (prototipo: createGrid y createAxes de
 * pim/modelos3d.js): drei <Grid infiniteGrid> (misma sombra de la versión
 * 9.114.3 del original) y el AxesHelper propio (longitud 1).
 */

const GRID_VERTEX = `
  varying vec3 localPosition;
  varying vec4 worldPosition;
  uniform vec3 worldCamProjPosition;
  uniform vec3 worldPlanePosition;
  uniform float fadeDistance;
  uniform bool infiniteGrid;
  uniform bool followCamera;
  void main() {
    localPosition = position.xzy;
    if (infiniteGrid) localPosition *= 1.0 + fadeDistance;
    worldPosition = modelMatrix * vec4(localPosition, 1.0);
    if (followCamera) {
      worldPosition.xyz += (worldCamProjPosition - worldPlanePosition);
      localPosition = (inverse(modelMatrix) * worldPosition).xyz;
    }
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }`;

const GRID_FRAGMENT = `
  varying vec3 localPosition;
  varying vec4 worldPosition;
  uniform vec3 worldCamProjPosition;
  uniform float cellSize;
  uniform float sectionSize;
  uniform vec3 cellColor;
  uniform vec3 sectionColor;
  uniform float fadeDistance;
  uniform float fadeStrength;
  uniform float fadeFrom;
  uniform float cellThickness;
  uniform float sectionThickness;
  float getGrid(float size, float thickness) {
    vec2 r = localPosition.xz / size;
    vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
    float line = min(grid.x, grid.y) + 1.0 - thickness;
    return 1.0 - min(line, 1.0);
  }
  void main() {
    float g1 = getGrid(cellSize, cellThickness);
    float g2 = getGrid(sectionSize, sectionThickness);
    vec3 from = worldCamProjPosition * vec3(fadeFrom);
    float dist = distance(from, worldPosition.xyz);
    float d = 1.0 - min(dist / fadeDistance, 1.0);
    vec3 color = mix(cellColor, sectionColor, min(1.0, sectionThickness * g2));
    gl_FragColor = vec4(color, (g1 + g2) * pow(d, fadeStrength));
    gl_FragColor.a = mix(0.75 * gl_FragColor.a, gl_FragColor.a, g2);
    if (gl_FragColor.a <= 0.0) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export type GridMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

export function createGrid(): GridMesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      cellSize: { value: 0.5 },
      sectionSize: { value: 1 },
      fadeDistance: { value: 20 },
      fadeStrength: { value: 1 },
      fadeFrom: { value: 1 },
      cellThickness: { value: 0.5 },
      sectionThickness: { value: 1 },
      cellColor: { value: new THREE.Color(SCENE.gridCell) },
      sectionColor: { value: new THREE.Color(SCENE.gridSection) },
      infiniteGrid: { value: true },
      followCamera: { value: false },
      worldCamProjPosition: { value: new THREE.Vector3() },
      worldPlanePosition: { value: new THREE.Vector3() },
    },
    vertexShader: GRID_VERTEX,
    fragmentShader: GRID_FRAGMENT,
    transparent: true,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
  mesh.frustumCulled = false;
  return mesh;
}

const plane = new THREE.Plane();
const up = new THREE.Vector3(0, 1, 0);
const origin = new THREE.Vector3(0, 0, 0);

/** Proyecta la cámara sobre el plano de la rejilla (el desvanecido sigue a la cámara). */
export function updateGrid(grid: GridMesh, camera: THREE.Camera): void {
  const uniforms = grid.material.uniforms;
  grid.updateMatrixWorld();
  plane.setFromNormalAndCoplanarPoint(up, origin).applyMatrix4(grid.matrixWorld);
  plane.projectPoint(camera.position, uniforms.worldCamProjPosition.value as THREE.Vector3);
  (uniforms.worldPlanePosition.value as THREE.Vector3).set(0, 0, 0).applyMatrix4(grid.matrixWorld);
}

export function createAxes(): THREE.Group {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, color: string, position: [number, number, number], rotation?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    group.add(mesh);
  };
  const cylinder = () => new THREE.CylinderGeometry(0.01, 0.01, 1, 8);
  const cone = () => new THREE.ConeGeometry(0.03, 0.1, 8);
  add(cylinder(), SCENE.axisX, [0.5, 0, 0], [0, 0, Math.PI / 2]);
  add(cone(), SCENE.axisX, [1, 0, 0]);
  add(cylinder(), SCENE.axisY, [0, 0.5, 0]);
  add(cone(), SCENE.axisY, [0, 1, 0]);
  add(cylinder(), SCENE.axisZ, [0, 0, 0.5], [Math.PI / 2, 0, 0]);
  add(cone(), SCENE.axisZ, [0, 0, 1], [Math.PI / 2, 0, 0]);
  return group;
}

/** Cubo de EmptyModel: azul Uonify + wireframe decorativo neutro (no le afecta «Wireframe»). */
export function createPlaceholderCube(): THREE.Object3D[] {
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: SCENE.cube, metalness: 0.3, roughness: 0.4, emissive: SCENE.cubeGlow, emissiveIntensity: 0.2 }),
  );
  cube.position.set(0, 0.5, 0);
  const wire = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ color: SCENE.wire, wireframe: true }));
  wire.position.set(0, 0.5, 0);
  wire.userData.m3dFixed = true;
  return [cube, wire];
}
