import axios from 'axios';

/** Preserve the server's explanation of a rejected operation. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data?.error === 'string') return data.error;
    // Oxy's error envelope: { error: { code, message } }.
    if (typeof data?.error?.message === 'string') return data.error.message;
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}
