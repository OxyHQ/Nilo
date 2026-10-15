import type { ExportFormat } from '../export-formats';
import type { Database } from '../types/databases';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DocumentPickerAsset } from 'expo-document-picker';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
import { exportFilename, importSelection, MAX_IMPORT_BYTES } from '../page-transfer';

export interface ImportResult {
  database?: Database;
  rows?: number;
  pages: { id: string; title: string; parentId: string | null }[];
  skipped: string[];
}

interface ImportInput {
  workspaceId: string;
  parentId?: string | null;
  teamspaceId?: string | null;
  assets: DocumentPickerAsset[];
  onProgress: (percent: number | null) => void;
}

export function useImportPages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, parentId, teamspaceId, assets, onProgress }: ImportInput) => {
      const kind = importSelection(assets);
      const config = {
        timeout: 120_000,
        onUploadProgress: ({ loaded, total }: { loaded: number; total?: number }) =>
          onProgress(total ? Math.round((loaded / total) * 100) : null),
      };
      if (kind === 'csv') {
        const csv = await (await fetch(assets[0].uri)).text();
        const body = JSON.stringify({
          workspaceId,
          teamspaceId,
          parentPageId: parentId ?? undefined,
          name: assets[0].name.replace(/\.csv$/i, ''),
          csv,
        });
        if (new Blob([body]).size > MAX_IMPORT_BYTES) throw new Error('tooLarge');
        const response = await apiClient.post<{ database: Database; rows: number }>(
          '/databases/import/csv',
          body,
          config,
        );
        return { ...response.data, pages: [], skipped: [] } as ImportResult;
      }
      if (kind === 'zip') {
        const body = await (await fetch(assets[0].uri)).arrayBuffer();
        if (body.byteLength > MAX_IMPORT_BYTES) throw new Error('tooLarge');
        const response = await apiClient.post<ImportResult>(API_ROUTES.pages.importZip, body, {
          ...config,
          params: {
            workspaceId,
            parentId: parentId ?? undefined,
            teamspaceId: teamspaceId === null ? 'private' : teamspaceId,
          },
          headers: { 'Content-Type': 'application/zip' },
        });
        return response.data;
      }
      const files = [];
      let bytes = 0;
      for (const asset of assets) {
        const content = await (await fetch(asset.uri)).text();
        bytes += new Blob([content]).size;
        if (bytes > MAX_IMPORT_BYTES) throw new Error('tooLarge');
        files.push({ path: asset.name, content });
      }
      const body = JSON.stringify({ workspaceId, parentId, teamspaceId, files });
      if (new Blob([body]).size > MAX_IMPORT_BYTES) throw new Error('tooLarge');
      const response = await apiClient.post<ImportResult>(API_ROUTES.pages.import, body, config);
      return response.data;
    },
    onSuccess: async (_result, { workspaceId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.databases.list(workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.list(workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.shared }),
        client.invalidateQueries({ queryKey: queryKeys.search.workspace(workspaceId) }),
      ]);
    },
  });
}

export function useExportPage() {
  return useMutation({
    mutationFn: async ({
      id,
      format,
      fallback,
    }: {
      id: string;
      format: ExportFormat;
      fallback: string;
    }) => {
      const response = await apiClient.get<Blob>(API_ROUTES.pages.export(id), {
        params: { format },
        responseType: 'blob',
      });
      return {
        blob: response.data,
        filename: exportFilename(response.headers['content-disposition'], `${fallback}.${format}`),
      };
    },
  });
}

export function useExportDatabase() {
  return useMutation({
    mutationFn: async ({ id, fallback }: { id: string; fallback: string }) => {
      const response = await apiClient.get<Blob>(`/databases/${id}/export`, {
        params: { format: 'csv' },
        responseType: 'blob',
      });
      return {
        blob: response.data,
        filename: exportFilename(response.headers['content-disposition'], `${fallback}.csv`),
      };
    },
  });
}
