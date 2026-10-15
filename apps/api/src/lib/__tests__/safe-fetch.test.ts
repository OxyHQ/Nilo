import { describe, expect, it } from 'vitest';
import { checkUrl, isPublicAddress, safeFetch, UnsafeUrlError } from '../safe-fetch.js';

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, metadata and reserved addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a9fe:a9fe',
    ]) {
      expect([address, isPublicAddress(address)]).toEqual([address, false]);
    }
  });

  it('accepts public addresses', () => {
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:1.1.1.1']) {
      expect([address, isPublicAddress(address)]).toEqual([address, true]);
    }
  });
});

describe('checkUrl', () => {
  it('refuses other schemes, ports, credentials and internal hosts', () => {
    for (const url of [
      'file:///etc/passwd',
      'gopher://example.com',
      'http://example.com:8080/',
      'http://user:pass@example.com/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://localhost/',
      'http://db.internal/',
    ]) {
      expect(() => checkUrl(url)).toThrow(UnsafeUrlError);
    }
    expect(checkUrl('https://example.com/a').hostname).toBe('example.com');
  });
});

describe('safeFetch', () => {
  it('never connects to the server itself', async () => {
    await expect(safeFetch('http://127.0.0.1/')).rejects.toThrow(UnsafeUrlError);
  });
});

describe('storedType (uploads)', async () => {
  const { storedType } = await import('../../routes/uploads.js');
  it('keeps media inline, makes documents download, and stores anything else as bytes', () => {
    expect(storedType('image/png')).toEqual({ contentType: 'image/png', inline: true });
    expect(storedType('application/pdf')).toEqual({ contentType: 'application/pdf', inline: true });
    expect(storedType('text/csv')).toEqual({ contentType: 'text/csv', inline: false });
    expect(storedType('text/html')).toEqual({
      contentType: 'application/octet-stream',
      inline: false,
    });
    expect(storedType('image/svg+xml')).toEqual({
      contentType: 'application/octet-stream',
      inline: false,
    });
    expect(storedType('IMAGE/JPEG; charset=x')).toEqual({
      contentType: 'image/jpeg',
      inline: true,
    });
  });
});
