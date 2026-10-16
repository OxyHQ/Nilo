import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NILO_OXY_APPLICATION_ID } from '@nilo/contracts';
import type { OxyServices } from '@oxy.so/core';
import apiClient from '@/lib/api/client';
import { FileScopeProvider, freshFileUrl, useFileImageSource, useFileScope } from '../file-urls';
import { FileTooLargeError, uploadPageFile } from '../upload-page-file';

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));
const post = apiClient.post as jest.Mock;
const mockGetCachePathAsync = jest.fn<Promise<string | null>, [string]>();
jest.mock('expo-image', () => ({
  Image: { getCachePathAsync: (key: string) => mockGetCachePathAsync(key) },
}));

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  post.mockReset();
});
afterEach(() => client.clear());

function fakeOxy() {
  const calls: string[] = [];
  const oxy = {
    assets: {
      upload: jest.fn(async () => {
        calls.push('upload');
        return { file: { id: 'oxy-file' } };
      }),
      link: jest.fn(async () => {
        calls.push('link');
        return {};
      }),
    },
  };
  return { oxy: oxy as unknown as OxyServices, raw: oxy, calls };
}

describe('uploadPageFile', () => {
  it('uploads privately, links the file to Nilo, records it, and keeps the first URL', async () => {
    const { oxy, raw, calls } = fakeOxy();
    post.mockImplementation(async () => {
      calls.push('record');
      return {
        data: {
          fileId: 'oxy-file',
          name: 'plan.png',
          mime: 'image/png',
          size: 10,
          url: 'https://files.example/oxy-file?sig=1',
          expiresIn: 300,
        },
      };
    });
    const picked = { uri: 'file:///plan.png', name: 'plan.png', type: 'image/png', size: 10 };

    const attached = await uploadPageFile(oxy, client, 'page-1', picked);

    expect(calls).toEqual(['upload', 'link', 'record']);
    expect(raw.assets.upload).toHaveBeenCalledWith(picked, { visibility: 'private' });
    expect(raw.assets.link).toHaveBeenCalledWith('oxy-file', {
      app: NILO_OXY_APPLICATION_ID,
      entityType: 'page',
      entityId: 'page-1',
    });
    expect(post).toHaveBeenCalledWith('/pages/page-1/files', {
      fileId: 'oxy-file',
      name: 'plan.png',
    });
    expect(attached).toEqual({
      fileId: 'oxy-file',
      name: 'plan.png',
      mimeType: 'image/png',
      size: 10,
    });

    // The uploader's first look needs no second request.
    const url = await freshFileUrl(client, { kind: 'page', pageId: 'page-1' }, 'oxy-file');
    expect(url).toBe('https://files.example/oxy-file?sig=1');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('refuses a file over the limit before uploading anything', async () => {
    const { oxy, raw } = fakeOxy();
    await expect(
      uploadPageFile(oxy, client, 'page-1', {
        uri: 'file:///big',
        name: 'big.bin',
        type: 'application/octet-stream',
        size: 101 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(raw.assets.upload).not.toHaveBeenCalled();
  });
});

describe('file URLs', () => {
  it('ask through a share link or a published page, as the reader reached the page', async () => {
    post.mockResolvedValue({ data: { files: [{ id: 'f', url: 'https://u', expiresIn: 300 }] } });
    await freshFileUrl(client, { kind: 'share', token: 'tok' }, 'f');
    await freshFileUrl(client, { kind: 'published', slug: 'site', pageId: 'sub' }, 'f');
    expect(post).toHaveBeenNthCalledWith(1, '/share/tok/files/urls', { ids: ['f'] });
    expect(post).toHaveBeenNthCalledWith(2, '/public/pages/site/files/urls', {
      pageId: 'sub',
      ids: ['f'],
    });
  });

  it('answer null for a file the reader may not have', async () => {
    post.mockResolvedValue({ data: { files: [] } });
    expect(await freshFileUrl(client, { kind: 'page', pageId: 'p' }, 'gone')).toBeNull();
  });

  it('take the scope from the provider, else the block page', () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useFileScope('own-page'));
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        <>
          <Probe />
          <FileScopeProvider scope={{ kind: 'share', token: 'tok' }}>
            <Probe />
          </FileScopeProvider>
        </>,
      );
    });
    expect(seen).toEqual([
      { kind: 'page', pageId: 'own-page' },
      { kind: 'share', token: 'tok' },
    ]);
    act(() => renderer?.unmount());
  });
});

describe('attached images', () => {
  async function sourceFor(fileId: string) {
    let source: unknown;
    function Probe() {
      source = useFileImageSource({ kind: 'page', pageId: 'p' }, fileId);
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => renderer?.unmount());
    return source;
  }

  it('show the minted URL, cached under the file id', async () => {
    post.mockResolvedValue({
      data: { files: [{ id: 'img', url: 'https://u/img', expiresIn: 300 }] },
    });
    expect(await sourceFor('img')).toEqual({ uri: 'https://u/img', cacheKey: 'img' });
  });

  it('fall back to the copy kept on disk when no URL can be had', async () => {
    post.mockRejectedValue(new Error('offline'));
    mockGetCachePathAsync.mockResolvedValue('/data/cache/img');
    expect(await sourceFor('img')).toEqual({ uri: 'file:///data/cache/img' });
    expect(mockGetCachePathAsync).toHaveBeenCalledWith('img');
  });
});
