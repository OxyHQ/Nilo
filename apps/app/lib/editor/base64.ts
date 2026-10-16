/** Bytes as base64 and back, with the `btoa`/`atob` both Hermes and browsers have. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // In chunks: one huge String.fromCharCode call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
