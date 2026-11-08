import { useCallback, useRef, useState } from 'react';
import { toast } from '@/shared/ui';
import { fieldKeyFromName, managerCustomField, movedCustomField, movedFieldData, neighbourOf } from '../model/fields';
import { withValidation } from '../model/validation';
import { useAuditStore } from './useAuditStore';
import { useAuditFocus } from './useAuditFocus';

/**
 * DragDropFieldManager del original: mover campos faltantes a la gestión (arrastrando,
 * con clic, teclado o toque; E22) y crear campos personalizados (E23). Estado local:
 * se pierde cuando la sección del esquema desaparece, como en el original.
 */
export function useFieldManager() {
  const { read, patch, setCustomFields } = useAuditStore();
  const requestFocus = useAuditFocus();
  const [draggedFields, setDraggedFields] = useState<string[]>([]);
  // E22: el soltar usa el estado actual (sin closure congelado).
  const draggedRef = useRef<string[]>([]);
  const [isAddingField, setIsAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');

  const dropField = useCallback((fieldName: string, { keyboard = false }: { keyboard?: boolean } = {}) => {
    const audit = read();
    const dragged = draggedRef.current;
    if (!fieldName || dragged.includes(fieldName)) return;
    const available = audit.missingFields.filter(field => !dragged.includes(field));
    const nextField = neighbourOf(available, fieldName);
    const data = movedFieldData(fieldName, audit.uonifySchema);
    // handleFieldMove: campo personalizado sin confirmar y, si falta, el campo editable.
    setCustomFields(prev => [...prev, movedCustomField(fieldName, data)]);
    if (audit.showSchemaComparison && !audit.editableFields[fieldName]) {
      patch({ editableFields: { ...audit.editableFields, [fieldName]: data.value } });
    }
    draggedRef.current = [...dragged, fieldName];
    setDraggedFields(draggedRef.current);
    toast.success(`Campo "${data.name}" agregado a gestión`);
    if (keyboard) requestFocus(nextField ? `drag:${nextField}` : 'toggle-add-field');
  }, [read, patch, setCustomFields, requestFocus]);

  /** handleAddFieldFromManager: E23, el duplicado se detecta aunque el campo esté vacío. */
  const addFieldFromManager = useCallback((fieldName: string, fieldValue: string, fieldType: string): boolean => {
    if (!fieldName.trim()) {
      toast.error('Ingresa un nombre para el campo');
      return false;
    }
    const audit = read();
    if (Object.prototype.hasOwnProperty.call(audit.editableFields, fieldName)) {
      toast.error('Ya existe un campo con ese nombre');
      return false;
    }
    setCustomFields(prev => [...prev, managerCustomField(fieldName, fieldValue, fieldType)]);
    patch(withValidation(audit, { ...audit.editableFields, [fieldName]: fieldValue }));
    toast.success(`Campo "${fieldName}" agregado`);
    return true;
  }, [read, patch, setCustomFields]);

  const createField = useCallback(() => {
    if (!newFieldName.trim()) {
      toast.error('Ingresa un nombre para el campo');
      requestFocus('new-field-name');
      return;
    }
    const createdName = newFieldName;
    if (!addFieldFromManager(fieldKeyFromName(createdName), newFieldValue, newFieldType)) {
      requestFocus('new-field-name');
      return;
    }
    setNewFieldName('');
    setNewFieldValue('');
    setNewFieldType('text');
    setIsAddingField(false);
    toast.success(`Campo personalizado "${createdName}" creado`);
    requestFocus('toggle-add-field');
  }, [newFieldName, newFieldValue, newFieldType, addFieldFromManager, requestFocus]);

  const toggleAddField = useCallback(() => {
    const opening = !isAddingField;
    setIsAddingField(opening);
    if (opening) requestFocus('new-field-name');
  }, [isAddingField, requestFocus]);

  const cancelAddField = useCallback(() => {
    setIsAddingField(false);
    requestFocus('toggle-add-field');
  }, [requestFocus]);

  return {
    draggedFields,
    dropField,
    form: { isAddingField, newFieldName, newFieldValue, newFieldType, setNewFieldName, setNewFieldValue, setNewFieldType },
    createField,
    toggleAddField,
    cancelAddField,
  };
}

export type FieldManager = ReturnType<typeof useFieldManager>;
