import { conversationFormOf, formResponse } from '../model/conversationForm';
import { restoreWorkspace } from '../model/workspaceState';

const sample = { id: 'form-1', title: 'Prepara tu producto', fields: [
  { id: 'name', label: 'Nombre', type: 'text', required: true },
  { id: 'materials', label: 'Materiales', type: 'select', required: false, options: ['Tengo archivos', 'Desde cero'] },
] };

it('solo admite la elección inline informativa de materiales, nunca una autorización o formulario arbitrario', () => {
  const source = { id: 'source-choice', title: 'Empezar producto', presentation: 'inline_choice', fields: [
    { id: 'product_sources', label: '¿Tienes fotos o documentos del producto, o partimos desde cero?', type: 'select', required: true,
      options: ['Tengo una carpeta en Drive', 'Partimos desde cero'] },
  ] };
  expect(conversationFormOf(source, 'assistant')).toEqual(source);
  expect(conversationFormOf(source, 'user')).toBeUndefined();
  expect(conversationFormOf({ ...source, fields: [{ ...source.fields[0], id: 'authorize_analysis' }] }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...source, fields: [{ ...source.fields[0], options: ['Autorizar análisis', 'Cancelar'] }] }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...source, fields: [...source.fields, sample.fields[0]] }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...source, context: { kind: 'product_guide', sku: 'BASIC', revision: 1, section: 'choice' } }, 'assistant')).toBeUndefined();
});

it('admite espera de razonamiento sin campos solo para requisitos Amazon y valida el estado', () => {
  const waiting = { id: 'reasoning-1', title: 'Revisión de Uony', fields: [], context: { kind: 'product_guide',
    sku: 'LAMP-2', revision: 4, section: 'amazon_requirements', step: 'reasoning' },
    reasoning: { id: 'job-1', status: 'running', message: 'Uony está revisando tus documentos e imágenes.' } };
  expect(conversationFormOf(waiting, 'assistant')).toEqual(waiting);
  const preparing = { ...waiting, reasoning: { id: null, status: 'stale', message: 'Tus documentos están listos.', requiresPreparation: true, canRetry: true } };
  expect(conversationFormOf(preparing, 'assistant')).toEqual(preparing);
  expect(conversationFormOf({ ...waiting, reasoning: { ...waiting.reasoning, status: 'approved' } }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...waiting, context: { ...waiting.context, step: 'fields' } }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...sample, fields: [] }, 'assistant')).toBeUndefined();
});

it('solo admite formularios de Uony con contrato completo y elimina propiedades ejecutables', () => {
  expect(conversationFormOf(sample, 'user')).toBeUndefined();
  expect(conversationFormOf({ ...sample, action: 'https://external.test', fields: sample.fields.map(field => ({ ...field, onclick: 'send()' })) }, 'assistant')).toEqual(sample);
  for (const fields of [[], Array(9).fill(sample.fields[0]), [sample.fields[0], sample.fields[0]], [{ ...sample.fields[0], id: '__proto__' }], [{ ...sample.fields[0], type: 'file' }], [{ ...sample.fields[0], required: 'yes' }], [{ ...sample.fields[1], options: ['Una', 'Una'] }], [{ ...sample.fields[1], value: 'Otra' }]]) {
    expect(conversationFormOf({ ...sample, fields }, 'assistant')).toBeUndefined();
  }
  for (const title of ['Introduce tu contraseña', 'Clave API privada', '<script>send()</script>', 'Entra en https://external.test', 'Texto\u0000oculto']) {
    expect(conversationFormOf({ ...sample, title }, 'assistant')).toBeUndefined();
  }
});

it('valida obligatorios, selección y límite completo antes de convertir en mensaje', () => {
  const form = conversationFormOf(sample, 'assistant')!;
  expect(formResponse(form, {})).toEqual({ error: 'Completa «Nombre» para continuar.' });
  expect(formResponse(form, { name: 'Juego', materials: 'HTML' })).toHaveProperty('error');
  expect(formResponse(form, { name: 'x'.repeat(3000) })).toHaveProperty('error');
  expect(formResponse(form, { name: ' Juego de madera ', materials: 'Desde cero' })).toEqual({ text: 'Prepara tu producto\nNombre: Juego de madera\nMateriales: Desde cero' });
});

it('restaura solo formularios válidos del asistente, nunca los inyectados por otros roles', () => {
  const restored = restoreWorkspace({ threads: [{ id: 't', title: 'Prueba', messages: [
    { role: 'assistant', text: 'Responde aquí', conversationForm: sample },
    { role: 'user', text: 'Respuesta', conversationForm: sample },
    { role: 'system', text: 'Contenido desconocido', conversationForm: sample },
  ] }] });
  expect(restored.threads[0].messages.map(message => message.conversationForm)).toEqual([sample, undefined, undefined]);
});

it('admite respuesta libre explícita sin convertirla en una opción o acción del sistema', () => {
  const form = conversationFormOf(sample, 'assistant')!;
  const values = { name: 'Juego', materials: 'Tengo unas fotos y necesito completar los textos' };
  expect(formResponse(form, values)).toHaveProperty('error');
  expect(formResponse(form, values, new Set(['materials']))).toEqual({ text: 'Prepara tu producto\nNombre: Juego\nMateriales: Tengo unas fotos y necesito completar los textos' });
  expect(formResponse(form, values, new Set(['unrelated']))).toHaveProperty('error');
  expect(formResponse(form, { name: ' ', materials: values.materials }, new Set(['materials']))).toHaveProperty('error');
  expect(formResponse(form, { ...values, materials: 'x'.repeat(3000) }, new Set(['materials']))).toHaveProperty('error');
  expect(form.fields[1].options).toEqual(['Tengo archivos', 'Desde cero']);
});

it('conserva solo el contexto permitido para responder a la guía del mismo producto', () => {
  const context = { kind: 'product_guide', sku: 'JUEGO-1', revision: 2, section: 'choice' };
  expect(conversationFormOf({ ...sample, context }, 'assistant')?.context).toEqual(context);
  for (const invalid of [{ ...context, sku: '../otro' }, { ...context, revision: 0 }, { ...context, section: 'eliminar' }, { ...context, kind: 'execute' }]) {
    expect(conversationFormOf({ ...sample, context: invalid }, 'assistant')).toBeUndefined();
  }
});

it('resume la conversación de guía sin perder respuestas completas y permite dejar datos opcionales pendientes', () => {
  const context = { kind: 'product_guide', sku: 'JUEGO-1', revision: 2, section: 'imagenes' };
  const guide = conversationFormOf({ ...sample, context, fields: [{ id: 'materials', label: 'Materiales', type: 'textarea', required: false, value: 'https://drive.google.com/archivo' }] }, 'assistant')!;
  expect(guide.fields[0].value).toContain('https://');
  expect(formResponse(guide, {})).toEqual({ text: 'Prepara tu producto\nContinuar con estos datos pendientes.' });
  const values = { name: 'Juego', materials: 'x'.repeat(2990) };
  const multi = conversationFormOf({ ...sample, context }, 'assistant')!;
  expect(formResponse(multi, values, new Set(['materials'])).text!.length).toBeLessThanOrEqual(3000);
  expect(values.materials).toHaveLength(2990);
  expect(formResponse(multi, { name: '', materials: '' })).toHaveProperty('error');
});

it('valida tipos y opciones cerradas de Amazon sin cerrar las alternativas abiertas', () => {
  const context = { kind: 'product_incident', incidentId: '11111111-1111-4111-8111-111111111111', revision: 2, step: 'edit', candidate: { ignored: 'server only' } };
  const incident = conversationFormOf({ ...sample, context, fields: [
    { id: 'weight', label: 'Peso', type: 'text', required: true, validation: { number: 'number', minimum: 0.1 } },
    { id: 'unit', label: 'Unidad', type: 'select', required: true, options: ['Gramos', 'Kilogramos'], closed: true },
    { id: 'material', label: 'Material', type: 'select', required: false, options: ['Madera'], closed: false },
  ] }, 'assistant')!;
  expect(incident.context).not.toHaveProperty('candidate');
  expect(formResponse(incident, { weight: 'mucho', unit: 'Gramos' })).toHaveProperty('error');
  expect(formResponse(incident, { weight: '-1', unit: 'Gramos' })).toHaveProperty('error');
  expect(formResponse(incident, { weight: '2', unit: 'Inválida' }, new Set(['unit']))).toHaveProperty('error');
  expect(formResponse(incident, { weight: '0,5', unit: 'Gramos', material: 'Metal' }, new Set(['material']))).toHaveProperty('text');
});

it('mantiene revisión de valores sin aceptar pasos o acciones ejecutables inventadas', () => {
  const context = { kind: 'product_incident', incidentId: '11111111-1111-4111-8111-111111111111', revision: 2, step: 'review' };
  const review = [{ label: 'Peso', before: '0.2 kilogramos', after: '0.3 kilogramos' }];
  expect(conversationFormOf({ ...sample, context, review, submitLabel: 'Confirmar elección', endpoint: '/delete' }, 'assistant')).toMatchObject({ review, submitLabel: 'Confirmar elección' });
  expect(conversationFormOf({ ...sample, context: { ...context, step: 'send' } }, 'assistant')).toBeUndefined();
});

it('los atributos PTD servidos admiten nombres legítimos y conservan HTML como texto', () => {
  const context = { kind: 'product_incident', incidentId: '11111111-1111-4111-8111-111111111111', revision: 2, step: 'edit' };
  const fields = [{ id: 'field0', label: 'Tarjeta de memoria', type: 'text', required: true, value: '<p>Temperatura < 20</p>' }];
  const parsed = conversationFormOf({ ...sample, title: 'TOKEN-01 · Incidencia', context, fields }, 'assistant');
  expect(parsed?.fields[0].value).toBe(fields[0].value);
  expect(conversationFormOf({ ...sample, title: 'TOKEN-01 · Incidencia', fields }, 'assistant')).toBeUndefined();
});

it('acepta preguntas dinámicas PTD de creación con evaluación y valida sus opciones cerradas', () => {
  const context = { kind: 'product_guide', sku: 'BRICKS-01', revision: 4, section: 'amazon_requirements', step: 'fields', evaluationId: 'schema-product-4' };
  const fields = [{ id: 'f_material', label: 'Material del producto', type: 'select', required: true, options: ['Madera', 'Bambú'], closed: true,
    hint: 'Elige uno de los valores permitidos por Amazon.', suggestion: { value: 'Madera', source: 'Ficha técnica aportada' } }];
  const form = conversationFormOf({ ...sample, context, fields }, 'assistant')!;
  expect(form.context).toEqual(context);
  expect(form.fields[0]).toMatchObject({ closed: true, hint: fields[0].hint, suggestion: fields[0].suggestion });
  expect(form.fields[0].value).toBeUndefined();
  expect(formResponse(form, { f_material: 'Plástico' }, new Set(['f_material']))).toHaveProperty('error');
  expect(formResponse(form, { f_material: 'Madera' })).toHaveProperty('text');
  expect(conversationFormOf({ ...sample, context: { ...context, evaluationId: undefined }, fields }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...sample, context: { ...context, step: 'publish' }, fields }, 'assistant')).toBeUndefined();
});

it('los pasos de elegir categoría no necesitan una evaluación ni permiten contexto ejecutable', () => {
  const context = { kind: 'product_guide', sku: 'BRICKS-01', revision: 1, section: 'amazon_requirements', step: 'reference' };
  expect(conversationFormOf({ ...sample, context: { ...context, execute: true } }, 'assistant')?.context).toEqual(context);
  expect(conversationFormOf({ ...sample, context: { ...context, step: undefined } }, 'assistant')).toBeUndefined();
});

it('admite los 544 idiomas de Amazon solo en requisitos de producto servidos por el backend', () => {
  const context = { kind: 'product_guide', sku: 'BRICKS-01', revision: 4, section: 'amazon_requirements', step: 'fields', evaluationId: 'schema-product-4' };
  const fields = [{ id: 'language', label: 'Idioma de las advertencias', type: 'select', required: true, closed: true, options: Array.from({ length: 544 }, (_, index) => `Idioma ${index}`) }];
  const parsed = conversationFormOf({ ...sample, context, fields }, 'assistant');
  expect(parsed?.fields[0].options).toHaveLength(544);
  expect(conversationFormOf({ ...sample, fields }, 'assistant')).toBeUndefined();
  expect(conversationFormOf({ ...sample, context, fields: [{ ...fields[0], options: Array.from({ length: 1001 }, (_, index) => `Idioma ${index}`) }] }, 'assistant')).toBeUndefined();
});
