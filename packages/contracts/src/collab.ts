/**
 * The largest single change to a page's document (a Yjs update) the server
 * takes: one batch while typing, or everything a device did offline, sent
 * on reconnecting. The socket's message limit is set from it, so a change
 * this size is answered, never a dropped connection.
 */
export const MAX_DOC_UPDATE_BYTES = 8 * 1024 * 1024;
