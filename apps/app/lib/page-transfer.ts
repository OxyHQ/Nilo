export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Prefer RFC 5987 UTF-8 names; keep a safe basename for browser downloads. */
export function exportFilename(disposition: unknown, fallback: string): string {
  let name: string | undefined;
  if (typeof disposition === 'string') {
    const encoded = /filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i.exec(disposition)?.[1];
    if (encoded) {
      try {
        name = decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''));
      } catch {
        // A malformed extended name can still have a valid plain filename.
      }
    }
    name ||=
      /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(disposition)?.[1]?.replace(/\\(.)/g, '$1') ??
      /filename\s*=\s*([^;]+)/i.exec(disposition)?.[1]?.trim();
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove control characters from server-provided filenames.
  const controls = /[\u0000-\u001f\u007f]/g;
  const basename = (name || fallback).split(/[\\/]/).pop()?.replace(controls, '').trim();
  return basename && basename !== '.' && basename !== '..' ? basename : fallback;
}

export function importSelection(assets: { name: string; size?: number }[]): 'md' | 'zip' {
  if (assets.length === 0) throw new Error('invalidFiles');
  if (assets.reduce((total, asset) => total + (asset.size ?? 0), 0) > MAX_IMPORT_BYTES) {
    throw new Error('tooLarge');
  }
  if (assets.length === 1 && /\.zip$/i.test(assets[0].name)) return 'zip';
  if (assets.every((asset) => /\.md$/i.test(asset.name))) return 'md';
  throw new Error('invalidFiles');
}
