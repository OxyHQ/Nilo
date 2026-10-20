/**
 * A collaborator's text selection, as the room carries it: Bloom's
 * `RelativeSelection` (`@oxy.so/bloom-editor/yjs`), a block and two Yjs
 * relative positions in its text, so it is still on the same characters on
 * every device whatever was typed meanwhile.
 *
 * It comes from the network and goes to everyone on the page, so it is read
 * field by field into a new object: only the shape Yjs writes
 * (`relativePositionToJSON`), with bounded numbers and strings, is passed on.
 * The editor resolves it against its own document and ignores what does not
 * resolve (`relativeToSelection`).
 */

/** A Yjs item id: the client that made it and its clock there. */
export interface YjsId {
  client: number;
  clock: number;
}

/** `Y.relativePositionToJSON`'s shape. */
export interface RelativePositionJSON {
  type?: YjsId;
  tname?: string;
  item?: YjsId;
  assoc?: number;
}

export interface PageSelection {
  blockId: string;
  start: RelativePositionJSON;
  end: RelativePositionJSON;
}

/** A root type's name is the document's own (`blocks`); a long one is not Bloom's. */
const MAX_TYPE_NAME = 64;
const POSITION_KEYS = new Set(['type', 'tname', 'item', 'assoc']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A non-negative safe integer: a client id (32-bit) or a clock. */
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function readId(value: unknown): YjsId | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !isCount(value.client) || !isCount(value.clock)) return null;
  return { client: value.client, clock: value.clock };
}

function readPosition(value: unknown): RelativePositionJSON | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !POSITION_KEYS.has(key))) return null;
  const position: RelativePositionJSON = {};
  if (value.type !== undefined) {
    const type = readId(value.type);
    if (!type) return null;
    position.type = type;
  }
  if (value.tname !== undefined) {
    if (typeof value.tname !== 'string' || value.tname.length > MAX_TYPE_NAME) return null;
    position.tname = value.tname;
  }
  if (value.item !== undefined) {
    const item = readId(value.item);
    if (!item) return null;
    position.item = item;
  }
  if (value.assoc !== undefined) {
    if (
      typeof value.assoc !== 'number' ||
      !Number.isSafeInteger(value.assoc) ||
      Math.abs(value.assoc) > 0x7fffffff
    )
      return null;
    position.assoc = value.assoc;
  }
  // A position names the text it is in, by id or by name.
  if (!position.type && position.tname === undefined) return null;
  return position;
}

/**
 * `value` as a selection in `blockId`'s text, or null for anything else: a
 * selection in another block than the one focused is no selection.
 */
export function readPageSelection(value: unknown, blockId: string | null): PageSelection | null {
  if (!isRecord(value) || blockId === null || value.blockId !== blockId) return null;
  if (Object.keys(value).some((key) => key !== 'blockId' && key !== 'start' && key !== 'end')) {
    return null;
  }
  const start = readPosition(value.start);
  const end = readPosition(value.end);
  return start && end ? { blockId, start, end } : null;
}
