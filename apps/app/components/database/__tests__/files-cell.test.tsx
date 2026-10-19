import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';
import { linkName, normalizeLink } from '../files-cell';
import type { PropertyValue } from '@/lib/types/databases';

const mockUpload = jest.fn();
const mockFreshUrl = jest.fn();
const mockOpenBrowser = jest.fn();
jest.mock('@/lib/files/upload-page-file', () => ({
  FileTooLargeError: class extends Error {},
  uploadPageFile: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('@/lib/files/file-urls', () => ({
  useFileScope: (pageId?: string) => (pageId ? { kind: 'page', pageId } : null),
  freshFileUrl: (...args: unknown[]) => mockFreshUrl(...args),
  isFileRemoved: () => false,
}));
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: async () => ({
    canceled: false,
    assets: [{ uri: 'file:///scan.pdf', name: 'scan.pdf', mimeType: 'application/pdf', size: 10 }],
  }),
}));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowser(...args),
}));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: { name: 'oxy' } }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({ useRelatedRows: () => ({}) }));

const property = { id: 'files', name: 'Files', type: 'files' } as const;
let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

function render(value: PropertyValue, props: { readOnly?: boolean; rowId?: string } = {}) {
  const onChange = jest.fn();
  act(() => {
    renderer = create(
      <QueryClientProvider client={new QueryClient()}>
        <BloomTestProviders>
          <PropertyCell property={property} value={value} onChange={onChange} {...props} />
        </BloomTestProviders>
      </QueryClientProvider>,
    );
  });
  return onChange;
}
function pressable(label: string) {
  const found = renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`nothing pressable named ${label}`);
  return found;
}
/** A Bloom button, found by its text. */
function button(text: string) {
  const found = renderer.root.findAll(
    (node) => node.props.children === text && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`no button ${text}`);
  return found;
}
/** Lets an action's awaited steps (a URL, a picker, an upload) finish. */
async function settle(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function openEditor() {
  act(() => pressable('Files').props.onPress());
}

it('shows files kept in Oxy storage, which have no link, beside linked ones', () => {
  render(
    {
      files: [
        { name: 'scan.pdf', fileId: 'file-1' },
        { name: 'same.png', url: 'https://example.test/a.png' },
        { name: 'again.png', url: 'https://example.test/a.png' },
      ],
    },
    { readOnly: true },
  );
  const text = JSON.stringify(renderer.toJSON());
  for (const name of ['scan.pdf', 'same.png', 'again.png']) expect(text).toContain(name);
});

it('opens a stored file through a URL minted for the row, and a link as it is', async () => {
  mockFreshUrl.mockResolvedValue('https://files.test/minted');
  render(
    {
      files: [
        { name: 'scan.pdf', fileId: 'file-1' },
        { name: 'site', url: 'https://example.test/a' },
      ],
    },
    { readOnly: true, rowId: 'row' },
  );
  await settle(() => pressable('scan.pdf').props.onPress());
  expect(mockFreshUrl).toHaveBeenCalledWith(
    expect.anything(),
    { kind: 'page', pageId: 'row' },
    'file-1',
  );
  expect(mockOpenBrowser).toHaveBeenLastCalledWith('https://files.test/minted');
  await settle(() => pressable('site').props.onPress());
  expect(mockOpenBrowser).toHaveBeenLastCalledWith('https://example.test/a');
});

it('uploads a file to the row’s page and keeps it as its file id and name', async () => {
  mockUpload.mockResolvedValue({ fileId: 'new-file', name: 'scan.pdf', mimeType: '', size: 10 });
  const onChange = render(
    { files: [{ name: 'old', url: 'https://example.test/old' }] },
    {
      rowId: 'row',
    },
  );
  openEditor();
  await settle(() => button('databases.files.upload').props.onPress());
  expect(mockUpload).toHaveBeenCalledWith(
    { name: 'oxy' },
    expect.anything(),
    'row',
    expect.objectContaining({ uri: 'file:///scan.pdf', name: 'scan.pdf' }),
  );
  expect(onChange).toHaveBeenCalledWith({
    files: [
      { name: 'old', url: 'https://example.test/old' },
      { fileId: 'new-file', name: 'scan.pdf' },
    ],
  });
});

it('links a file by its address and removes one', () => {
  const onChange = render({ files: [{ name: 'scan.pdf', fileId: 'file-1' }] });
  openEditor();
  // Without the row there is nowhere to upload to: only a link is offered.
  expect(
    renderer.root.findAll((node) => node.props.children === 'databases.files.upload'),
  ).toHaveLength(0);
  const field = renderer.root.findAll(
    (node) =>
      node.props.label === 'databases.files.link' && typeof node.props.onChangeText === 'function',
  )[0];
  act(() => field?.props.onChangeText('example.test/docs/brief.pdf'));
  act(() => button('databases.files.addLink').props.onPress());
  expect(onChange).toHaveBeenLastCalledWith({
    files: [
      { name: 'scan.pdf', fileId: 'file-1' },
      { url: 'https://example.test/docs/brief.pdf', name: 'brief.pdf' },
    ],
  });
  act(() => pressable('databases.files.remove').props.onPress());
  expect(onChange).toHaveBeenLastCalledWith({ files: [] });
});

it('names a link by its last path part and refuses what is no address', () => {
  expect(normalizeLink(' example.test ')).toBe('https://example.test');
  expect(normalizeLink('ftp://example.test/x')).toBe('ftp://example.test/x');
  expect(normalizeLink('not a link')).toBeNull();
  expect(linkName('https://example.test/a/My%20file.pdf')).toBe('My file.pdf');
  expect(linkName('https://example.test/')).toBe('example.test');
});
