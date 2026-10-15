/**
 * How long the server remembers an applied block transaction's key, so a
 * retry under the same key is answered from the record instead of applied
 * again. A client must not resend a transaction older than this: the server
 * could no longer tell it was applied.
 */
export const TRANSACTION_KEY_RETENTION_MS = 24 * 60 * 60 * 1000;
