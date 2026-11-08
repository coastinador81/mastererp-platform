/**
 * Cámara de la animación del juego de piezas en Novedades (juego-uonify.js): se
 * acerca y sube mientras las piezas forman la torre (mitad de la animación) y vuelve
 * al encuadre del conjunto al final. Funciones puras para poder probarlas.
 */
export type KitPose = 'assembled' | 'tower';

export interface KitCamera { cameraOrbit: string; cameraTarget: string; fieldOfView: string }

/** Duración por defecto de la animación (s) si el modelo aún no la conoce. */
export const KIT_DEFAULT_DURATION = 8;

/** Curva suave (smoothstep) de 0 a 1. */
export const smoothstep = (value: number) => value * value * (3 - 2 * value);

export function kitCameraAt(currentTime: number, duration: number): KitCamera {
  const total = duration || KIT_DEFAULT_DURATION;
  const half = total / 2;
  const phase = Math.min(currentTime, Math.max(0, total - currentTime));
  const u = smoothstep(Math.max(0, Math.min(1, phase / half)));
  return {
    cameraOrbit: `${25 * u}deg ${38 + 27 * u}deg ${15 - 7 * u}m`,
    cameraTarget: `0m ${1.1 + 0.55 * u}m 0m`,
    fieldOfView: `${45 - 7 * u}deg`,
  };
}

/** Momento de la animación que corresponde a cada postura. */
export const poseTime = (pose: KitPose, duration: number) => (pose === 'tower' ? duration / 2 : 0);

/** Duración del paso animado entre posturas (ms). */
export const POSE_TWEEN_MS = 1400;

export const KIT_STATUS = {
  tower: 'Las piezas de los tres personajes, reunidas en una torre.',
  assembled: 'Productos, ERP y Agentes, construidos con las mismas piezas.',
  unavailable: 'La animación no está disponible. Se muestra la imagen del conjunto.',
} as const;
