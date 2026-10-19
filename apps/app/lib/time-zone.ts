/** The reader's IANA time zone, when the platform tells it: a view grouped by date groups in it. */
export function readerTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : undefined;
  } catch {
    return undefined;
  }
}
