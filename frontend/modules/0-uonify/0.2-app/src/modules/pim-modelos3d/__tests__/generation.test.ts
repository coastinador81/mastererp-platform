import { DEFAULT_GENERATOR_CONFIG, GENERATED_MODEL } from '../model/constants';
import { buildGeneratedModel, estimatedTime, GENERATION_STEPS, qualityFrom, simulatedTriangles, stepDelay } from '../model/generation';
import { activeGenerations, cancelGenerationRun, endGenerationRun, startGenerationRun } from '../model/pageState';
import { analysisResult, MAX_MODEL_SIZE, modelFormat, validateModelFile } from '../model/uploader';

/** Secuencia fija para Math.random. */
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length];
};

describe('Generador (simulación del original)', () => {
  test('9 pasos de 0 a 100 % con los textos del original y 300-700 ms cada uno', () => {
    expect(GENERATION_STEPS).toHaveLength(9);
    expect(GENERATION_STEPS[0]).toEqual({ progress: 0, step: 'Iniciando generación...' });
    expect(GENERATION_STEPS.at(-1)).toEqual({ progress: 100, step: '¡Modelo generado exitosamente!' });
    expect(stepDelay(() => 0)).toBe(300);
    expect(stepDelay(() => 1)).toBe(700);
  });

  test('tiempo estimado según calidad, detalle y texturas', () => {
    expect(estimatedTime(DEFAULT_GENERATOR_CONFIG)).toBe(60);
    expect(estimatedTime({ quality: 'draft', polyCount: 'low', textureResolution: '1024' })).toBe(19);
    expect(estimatedTime({ quality: 'ultra', polyCount: 'high', textureResolution: '4096' })).toBe(540);
  });

  test('triángulos según el nivel de detalle', () => {
    expect(simulatedTriangles('low', () => 0)).toBe(10000);
    expect(simulatedTriangles('medium', () => 0.999999)).toBe(119999);
    expect(simulatedTriangles('high', () => 0)).toBe(80000);
  });

  test('el resultado es el modelo simulado (cubo) con su validación', () => {
    const model = buildGeneratedModel({ ...DEFAULT_GENERATOR_CONFIG, textureResolution: '4096', generatePBR: false }, 'floor', {
      random: sequence(0.5, 0.5, 0.5),
      now: () => 1700000000000,
    });
    expect(model.url).toBe(GENERATED_MODEL);
    expect(model.name).toBe('model-floor-1700000000000.glb');
    expect(model.validationData).toMatchObject({ triangles: 80000, vertices: 48000, textureResolution: '4096x4096', hasMaterials: false, validationScore: 95 });
    expect(qualityFrom(model)).toEqual({ triangles: 80000, textureResolution: '4096x4096', validationScore: 95 });
  });

  test('una generación por producto; «Cancelar» la marca y al terminar se retira', () => {
    const first = startGenerationRun('UON-1');
    const second = startGenerationRun('UON-1');
    expect(first.cancelled).toBe(true);
    cancelGenerationRun('UON-1');
    expect(second.cancelled).toBe(true);
    endGenerationRun('UON-1', first);
    expect(activeGenerations.has('UON-1')).toBe(true);
    endGenerationRun('UON-1', second);
    expect(activeGenerations.has('UON-1')).toBe(false);
  });
});

describe('Cargar Modelo 3D (validación y análisis)', () => {
  test('valida extensión y tamaño', () => {
    expect(validateModelFile({ name: 'torre.GLB', size: 10, type: '' })).toEqual({ isValid: true });
    expect(validateModelFile({ name: 'torre.gltf', size: 10, type: 'model/gltf+json' })).toEqual({ isValid: true });
    expect(validateModelFile({ name: 'torre.obj', size: 10, type: '' })).toEqual({ isValid: false, error: 'Formato no soportado. Use GLB o glTF.' });
    expect(validateModelFile({ name: 'torre.glb', size: MAX_MODEL_SIZE + 1, type: '' })).toEqual({ isValid: false, error: 'Archivo muy grande. Máximo 50MB.' });
  });

  test('análisis: texturas, materiales y puntuación', () => {
    const complete = analysisResult(sequence(0, 0.9, 0.9, 0.4));
    expect(complete).toMatchObject({ triangles: 20000, vertices: 12000, hasTextures: true, hasMaterials: true, validationScore: 100, textureResolution: '2048x2048', warnings: [], errors: [] });
    const bare = analysisResult(sequence(0.5, 0.1, 0.05));
    expect(bare.textureResolution).toBe('Sin texturas');
    expect(bare.warnings).toEqual(['El modelo no tiene texturas. Se recomienda agregar texturas PBR.']);
    expect(bare.errors).toEqual(['El modelo no tiene materiales definidos.']);
    expect(bare.validationScore).toBe(80);
  });

  test('formato mostrado', () => {
    expect(modelFormat('Caja.GLB')).toBe('GLB');
    expect(modelFormat('caja.gltf')).toBe('glTF');
  });
});
