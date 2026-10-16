import apiClient from './api/client';
import { API_ROUTES } from './api/routes';

interface EmbedPreviewResponse {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  source?: string;
}

/**
 * Fetch OpenGraph-ish metadata for a URL. Backend caches; client may call this
 * eagerly when a user pastes a URL into a bookmark / embed block.
 */
export async function fetchEmbedPreview(url: string): Promise<EmbedPreviewResponse> {
  const res = await apiClient.post<EmbedPreviewResponse>(API_ROUTES.embed.preview, { url });
  return res.data;
}
