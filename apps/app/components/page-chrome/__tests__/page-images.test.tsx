// Activity's requests and interaction are covered by page-activity.test.tsx.
jest.mock('../page-activity', () => ({ PageActivity: () => null, PageActivityPanel: () => null }));
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image as ExpoImage } from 'expo-image';
import { Platform, Text } from 'react-native';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CoverDisplay } from '../cover-display';
import { IconDisplay } from '../icon-display';
import { encodeCoverFile, parseCover } from '../cover-value';
import { encodeIconFile, parseIcon } from '../icon-value';
import { PageImageUpload } from '../page-image-upload';

const mockUseFileImageSource = jest.fn((..._args: unknown[]) => ({
  uri: 'https://files.example.test/f1',
  cacheKey: 'f1',
}));
jest.mock('@/lib/files/file-urls', () => ({
  useFileScope: (pageId: string | undefined) => (pageId ? { kind: 'page', pageId } : null),
  useFileImageSource: (...args: unknown[]) => mockUseFileImageSource(...args),
}));
const mockUpload = jest.fn();
jest.mock('@/lib/files/upload-page-file', () => ({
  FileTooLargeError: class FileTooLargeError extends Error {},
  uploadPageFile: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));

let renderer: ReactTestRenderer | null = null;
const mount = (element: React.ReactElement) =>
  act(() => {
    renderer = create(<BloomTestProviders>{element}</BloomTestProviders>);
  });
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});
const root = () => (renderer as ReactTestRenderer).root;

const texts = () =>
  root()
    .findAllByType(Text)
    .map((node) => node.props.children);

describe('an image uploaded to the page', () => {
  it('is stored by file id, for the icon and the cover alike', () => {
    expect(parseIcon(encodeIconFile('f1'))).toEqual({ kind: 'file', fileId: 'f1' });
    expect(parseCover(encodeCoverFile('f1'))).toEqual({ kind: 'file', fileId: 'f1' });
    // No id is no image, never an empty one.
    expect(parseIcon('file:')).toEqual({ kind: 'none' });
    expect(parseCover('file:')).toEqual({ kind: 'none' });
  });

  it('is shown as an icon with the URL minted for a reader of its page', () => {
    mount(<IconDisplay value={encodeIconFile('f1')} pageId="p1" />);
    expect(mockUseFileImageSource).toHaveBeenCalledWith({ kind: 'page', pageId: 'p1' }, 'f1');
    expect(root().findByType(ExpoImage).props.source).toEqual({
      uri: 'https://files.example.test/f1',
      cacheKey: 'f1',
    });
  });

  it('is read through the share link or site that gave the reader the page', () => {
    const scope = { kind: 'share', token: 't1' } as const;
    mount(<CoverDisplay value={encodeCoverFile('f1')} pageId="p1" fileScope={scope} />);
    expect(mockUseFileImageSource).toHaveBeenCalledWith(scope, 'f1');
    expect(root().findAllByType(ExpoImage)).toHaveLength(1);
  });
});

describe('an encoded icon', () => {
  it.each([
    ['emoji:🚀', '🚀'],
    ['icon:star', null],
    ['file:f1', null],
  ])('%s is rendered, not printed', (value, shown) => {
    mount(<IconDisplay value={value} pageId="p1" />);
    expect(texts()).not.toContain(value);
    if (shown) expect(texts()).toContain(shown);
  });
});

describe('uploading an image for the icon or cover', () => {
  // The browser's file input; native picks from the library the same way.
  const os = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'web';
  });
  afterEach(() => {
    Platform.OS = os;
  });
  const choose = async (file: { name: string }) => {
    await act(async () => {
      root()
        .findByType('input')
        .props.onChange({ target: { files: [file], value: 'photo.jpg' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  it('records it on the page and hands back its file id', async () => {
    mockUpload.mockResolvedValueOnce({ fileId: 'f9', name: 'photo.jpg', mimeType: '', size: 1 });
    const onUploaded = jest.fn();
    mount(<PageImageUpload pageId="p1" hint="hint" onUploaded={onUploaded} />);
    const file = { name: 'photo.jpg' };
    await choose(file);
    expect(mockUpload).toHaveBeenCalledWith({}, {}, 'p1', file);
    expect(onUploaded).toHaveBeenCalledWith('f9');
  });

  it('says why an image was refused', async () => {
    const { FileTooLargeError } = jest.requireMock('@/lib/files/upload-page-file');
    mockUpload.mockRejectedValueOnce(new FileTooLargeError());
    const onUploaded = jest.fn();
    mount(<PageImageUpload pageId="p1" hint="hint" onUploaded={onUploaded} />);
    await choose({ name: 'huge.jpg' });
    expect(onUploaded).not.toHaveBeenCalled();
    expect(texts()).toContain('pages.imageUpload.tooLarge');
  });
});
