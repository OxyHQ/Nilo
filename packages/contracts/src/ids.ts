/**
 * The ids Nilo stores: a UUIDv7, or a 24-character hex id carried over from
 * the Mongo era. Equal to `isLiveEntityId` in `@oxy.so/db` (the API asserts
 * it), restated here so the app does not import the database package.
 */
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEntityId(value: unknown): boolean {
  return typeof value === 'string' && (OBJECT_ID_HEX.test(value) || UUID_V7.test(value));
}
