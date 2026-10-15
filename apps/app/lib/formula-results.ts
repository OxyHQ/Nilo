import type { DatabaseProperty, PropertyValue } from './types/databases';

/** Infer only the wire shape; expressions are evaluated exclusively by the API. */
export function resultProperty(
  property: DatabaseProperty,
  value: PropertyValue | undefined,
): DatabaseProperty {
  if (property.type === 'unique_id') return { ...property, type: 'number' };
  if (property.type !== 'formula') return property;
  const type =
    value && !('error' in value)
      ? 'number' in value
        ? 'number'
        : 'checked' in value
          ? 'checkbox'
          : 'start' in value
            ? 'date'
            : 'text'
      : 'text';
  return { ...property, type };
}

/**
 * The property as its rows' values show it: a formula takes the type of the
 * first row whose result is not an error (text when none has one).
 */
export function resultPropertyFromRows(
  property: DatabaseProperty,
  rows: readonly { properties: Record<string, PropertyValue | undefined> }[],
): DatabaseProperty {
  if (property.type !== 'formula') return resultProperty(property, undefined);
  const value = rows
    .map((row) => row.properties[property.id])
    .find((candidate) => candidate && !('error' in candidate));
  return resultProperty(property, value);
}

export function propertyExpression(name: string): string {
  return `prop(${JSON.stringify(name)})`;
}
