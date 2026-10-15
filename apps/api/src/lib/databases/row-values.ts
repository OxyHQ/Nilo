/**
 * A row's values as formulas read them, by property name: text as strings,
 * options as their names, dates as dates, people and relations as lists.
 * Formulas may read other formulas; a cycle is an error, not a hang.
 */
import type { DatabaseProperty, DatabaseSchema } from '../../db/schema/databases.js';
import type { PageRow } from '../../repositories/pages.js';
import { evaluateFormula, FormulaError, type FormulaValue } from './formula.js';
import { NAME_PROPERTY_ID } from './schema-defaults.js';

export function rowFormulaContext(
  row: PageRow,
  schema: DatabaseSchema,
  rollups: ReadonlyMap<string, FormulaValue>,
) {
  const byName = new Map(schema.properties.map((p) => [p.name, p]));
  const results = new Map<string, { value: FormulaValue; error: string | null }>();
  const evaluating = new Set<string>();
  const now = new Date();

  const stored = (property: DatabaseProperty): FormulaValue => {
    const value = (row.properties[property.id] ?? {}) as Record<string, unknown>;
    const optionName = (id: unknown) =>
      property.config?.options?.find((o) => o.id === id)?.name ?? '';
    const list = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]) : []);
    switch (property.type) {
      case 'text':
        return property.id === NAME_PROPERTY_ID
          ? row.title
          : typeof value.text === 'string'
            ? value.text
            : '';
      case 'number':
        return typeof value.number === 'number' ? value.number : null;
      case 'checkbox':
        return value.checked === true;
      case 'select':
      case 'status':
        return optionName(value.optionId);
      case 'multi_select':
        return list('optionIds').map(optionName);
      case 'date':
        return typeof value.start === 'string' ? new Date(value.start) : null;
      case 'url':
      case 'email':
      case 'phone':
        return typeof value.value === 'string' ? value.value : '';
      case 'person':
        return list('userIds').map(String);
      case 'files':
        return list('files').map((f) => String((f as { name?: unknown }).name ?? ''));
      case 'relation':
        return list('pageIds').map(String);
      case 'created_time':
        return row.createdAt;
      case 'last_edited_time':
        return row.updatedAt;
      case 'created_by':
        return [row.ownerId];
      case 'last_edited_by':
        return [row.lastEditedBy ?? row.ownerId];
      case 'rollup':
        return rollups.get(property.id) ?? null;
      case 'formula': {
        // A formula reading a broken one is broken too (a cycle marks them all).
        const result = evaluate(property);
        if (result.error) throw new FormulaError(result.error);
        return result.value;
      }
    }
  };

  function evaluate(property: DatabaseProperty): { value: FormulaValue; error: string | null } {
    const done = results.get(property.id);
    if (done) return done;
    if (evaluating.has(property.id)) throw new FormulaError(`"${property.name}" refers to itself`);
    evaluating.add(property.id);
    try {
      const result = evaluateFormula(property.config?.expression ?? '', {
        prop: (name) => {
          const target = byName.get(name);
          if (!target) throw new FormulaError(`There is no property "${name}"`);
          return stored(target);
        },
        now: () => now,
      });
      results.set(property.id, result);
      return result;
    } catch (err: unknown) {
      // A cycle surfaces from a nested formula: every formula on it is in error.
      if (!(err instanceof FormulaError)) throw err;
      const result = { value: null, error: err.message };
      results.set(property.id, result);
      return result;
    } finally {
      evaluating.delete(property.id);
    }
  }

  return { evaluate };
}
