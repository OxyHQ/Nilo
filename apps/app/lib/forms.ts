import type { DatabaseProperty, PropertyValue } from './types/databases';
import { reminderFields } from './reminder-time';

export const FORM_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
] as const;
export type FormFieldType = (typeof FORM_TYPES)[number];
export interface FormField {
  id: string;
  name: string;
  type: FormFieldType;
  required: boolean;
  options?: { id: string; name: string }[];
}
export interface PublicForm {
  title: string;
  description: string;
  requireSignIn: boolean;
  fields: FormField[];
}
export type FormDraft = Record<string, string | string[] | boolean>;

export function formFields(properties: DatabaseProperty[], hidden: string[]): FormField[] {
  return properties
    .filter((p) => FORM_TYPES.some((type) => type === p.type) && !hidden.includes(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as FormFieldType,
      required: p.id === 'name',
      options: p.config?.options,
    }));
}

/** Local calendar entry, like reminders, but answers may be in the past. */
export function parseFormDate(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^\d{2}:\d{2}$/.test(time))) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = (time || '00:00').split(':').map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(hours, minutes, 0, 0);
  const fields = reminderFields(result);
  if (fields.date !== date || fields.time !== (time || '00:00')) return null;
  return time ? result.toISOString() : date;
}

export function serializeForm(fields: FormField[], draft: FormDraft) {
  const values: Record<string, PropertyValue> = {};
  const errors: Record<string, 'required' | 'invalid'> = {};
  for (const field of fields) {
    const raw = draft[field.id];
    const text = typeof raw === 'string' ? raw.trim() : '';
    const selected = Array.isArray(raw) ? raw : [];
    if (field.required && !text && selected.length === 0 && raw !== true) {
      errors[field.id] = 'required';
      continue;
    }
    if (field.type === 'checkbox') {
      values[field.id] = { checked: raw === true };
      continue;
    }
    if (field.type === 'multi_select') {
      if (selected.some((id) => !field.options?.some((o) => o.id === id)))
        errors[field.id] = 'invalid';
      values[field.id] = { optionIds: selected };
      continue;
    }
    if (!text) {
      if (field.type === 'date' && draft[`${field.id}:time`]) errors[field.id] = 'invalid';
      continue;
    }
    switch (field.type) {
      case 'text':
        values[field.id] = { text };
        break;
      case 'number':
        if (!Number.isFinite(Number(text))) errors[field.id] = 'invalid';
        else values[field.id] = { number: Number(text) };
        break;
      case 'status':
      case 'select':
        if (!field.options?.some((o) => o.id === text)) errors[field.id] = 'invalid';
        else values[field.id] = { optionId: text };
        break;
      case 'date': {
        const time =
          typeof draft[`${field.id}:time`] === 'string'
            ? String(draft[`${field.id}:time`]).trim()
            : '';
        const start = parseFormDate(text, time);
        if (!start) errors[field.id] = 'invalid';
        else values[field.id] = { start, includeTime: Boolean(time) };
        break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[field.id] = 'invalid';
        values[field.id] = { value: text };
        break;
      case 'url':
        try {
          const url = new URL(text);
          if (!['http:', 'https:'].includes(url.protocol)) errors[field.id] = 'invalid';
        } catch {
          errors[field.id] = 'invalid';
        }
        values[field.id] = { value: text };
        break;
      case 'phone':
        values[field.id] = { value: text };
        break;
    }
  }
  return { values, errors };
}

export function retryAfterSeconds(header: unknown, now = Date.now()): number {
  if (typeof header !== 'string' && typeof header !== 'number') return 60;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(String(header));
  return Number.isFinite(date) ? Math.max(1, Math.ceil((date - now) / 1000)) : 60;
}
