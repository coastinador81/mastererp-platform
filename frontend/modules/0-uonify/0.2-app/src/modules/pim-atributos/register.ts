import { registerDefaultCustomFields, registerPublisher } from '@/shared/pim';
import { publishToAmazon } from './api/amazonPublisher';
import { defaultCustomFields } from './model/customFields';

/**
 * Registros de Atributos en @/shared/pim al importar el módulo (prototipo:
 * UonifyPIM.publishers.Amazon y UonifyPIM.defaultCustomFields):
 * - el publicador de Amazon que usa «Publicar» (el mismo envío que «Guardar Cambios»);
 * - la lista inicial de campos personalizados que catalog siembra en `customFields`.
 */
registerPublisher('Amazon', publishToAmazon);
registerDefaultCustomFields(defaultCustomFields);
