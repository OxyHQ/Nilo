/**
 * Attach a file to a page: upload it to Oxy's file manager under the
 * member's own session (they own it there), link it to Nilo so Oxy will
 * serve it to Nilo, and record it on the page (`@oxy.so/nilo-contracts` `files.ts`).
 */
import {
  type FileUrl,
  MAX_FILE_BYTES,
  NILO_FILE_ENTITY_TYPE,
  NILO_OXY_APPLICATION_ID,
} from '@oxy.so/nilo-contracts';
import type { OxyServices } from '@oxy.so/core';
import type { QueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { rememberFileUrl } from './file-urls';

/** A picked file: a browser `File`, or a file on the device by its URI. */
export type PickedFile = File | { uri: string; name: string; type: string; size?: number };

export interface AttachedFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
}

export class FileTooLargeError extends Error {
  constructor() {
    super('This file is too large');
    this.name = 'FileTooLargeError';
  }
}

export async function uploadPageFile(
  oxy: OxyServices,
  queryClient: QueryClient,
  pageId: string,
  file: PickedFile,
): Promise<AttachedFile> {
  const name = file.name || 'file';
  if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) throw new FileTooLargeError();

  const { file: uploaded } = await oxy.assets.upload(file, { visibility: 'private' });
  await oxy.assets.link(uploaded.id, {
    app: NILO_OXY_APPLICATION_ID,
    entityType: NILO_FILE_ENTITY_TYPE,
    entityId: pageId,
  });
  const recorded = await apiClient.post<{
    fileId: string;
    name: string;
    mime: string;
    size: number;
    url?: string;
    expiresIn?: number;
  }>(API_ROUTES.files.record(pageId), { fileId: uploaded.id, name });

  const { fileId, url, expiresIn } = recorded.data;
  if (url && typeof expiresIn === 'number') {
    const minted: FileUrl = { id: fileId, url, expiresIn };
    rememberFileUrl(queryClient, { kind: 'page', pageId }, minted);
  }
  return {
    fileId,
    name: recorded.data.name,
    mimeType: recorded.data.mime,
    size: recorded.data.size,
  };
}
