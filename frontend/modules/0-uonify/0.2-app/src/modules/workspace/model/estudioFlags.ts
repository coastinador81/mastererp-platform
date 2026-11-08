/**
 * Banderas del Estudio en el chat. El cableado del CLIP SIMPLE por rutas HTTP (motor 090, contrato v1 de SC) está
 * APAGADO por defecto: en la app viva no se activa hasta que el backend esté desplegado + OK de Consultor/REA + dueño
 * + flip. Mientras, el flujo real se demuestra con un STUB en la maqueta de desarrollo (`estudio-clip-preview.html`).
 *
 * Encendido explícito (nunca se enciende solo):
 *  - build/dev: VITE_ESTUDIO_CLIP_WIRING=true.
 *  - opt-in por URL para una prueba puntual: `?estudio=clip` (o `on`/`1`) en la query con la que se CARGA el documento.
 *
 * NO ES PEGAJOSO (fix 30-10, CEO): el override vale SOLO para la carga actual. La query inicial se captura en la
 * evaluación del módulo (ANTES del redirect del espacio que la limpia), así que `?estudio=clip` surte efecto en esa
 * misma carga; pero NO se recuerda. Una sesión LIMPIA del dueño (sin el parámetro) NUNCA monta el andamio del Estudio.
 * Antes se persistía en localStorage y quedaba encendido para siempre por navegador, lo que exponía el andamio crudo
 * en el recorrido del dueño (tarjeta de vídeo prematura/fuera de lugar). Se retira esa persistencia y, por migración,
 * se limpia la clave antigua por si algún navegador quedó encendido.
 */
export const ESTUDIO_CLIP_WIRING: boolean = import.meta.env.VITE_ESTUDIO_CLIP_WIRING === 'true';

// Clave de la persistencia ANTIGUA (retirada): se limpia al cargar para des-encender navegadores que quedaron pegados.
const LEGACY_OVERRIDE_KEY = 'uonify-estudio-clip';

// Query con la que se CARGÓ el documento, capturada en la evaluación del módulo (antes del redirect que la limpia).
const INITIAL_SEARCH = typeof window === 'undefined' ? '' : window.location.search;

// Migración: retirar la persistencia pegajosa anterior. No se vuelve a escribir nunca.
try {
  if (typeof window !== 'undefined') window.localStorage?.removeItem(LEGACY_OVERRIDE_KEY);
} catch {
  /* El almacenamiento del navegador es opcional. */
}

/** ¿Trae la query INICIAL el opt-in explícito `?estudio=clip|on|1`? (solo esta carga; no se recuerda). */
function initialOverrideOn(): boolean {
  try {
    const q = new URLSearchParams(INITIAL_SEARCH).get('estudio');
    return q === 'clip' || q === 'on' || q === '1';
  } catch {
    return false;
  }
}

/** ¿Debe la app viva usar las rutas HTTP del clip? Gated; falso salvo encendido explícito y NO pegajoso. */
export function estudioClipWiringEnabled(): boolean {
  return ESTUDIO_CLIP_WIRING || initialOverrideOn();
}
