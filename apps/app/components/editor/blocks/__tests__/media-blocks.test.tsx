import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer } from 'expo-video';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import type { Block } from '@/lib/types/pages';
import { AudioBlock } from '../audio-block';
import { AudioPlayer, VideoPlayer } from '../media-players';
import { VideoBlock, videoEmbedUrl } from '../video-block';

const mockUpload = jest.fn();
let mockMinted: string | null = 'https://files.example/v1?sig=a';
let mockRemoved = false;
jest.mock('@/lib/files/file-urls', () => ({
  useFileScope: (pageId: string) => ({ kind: 'page', pageId }),
  useMediaFileUrl: (_scope: unknown, fileId: string | null) => (fileId ? mockMinted : null),
  useFileRemoved: () => mockRemoved,
}));
jest.mock('@/lib/files/upload-page-file', () => ({
  uploadPageFile: (...args: unknown[]) => mockUpload(...args),
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));

const block = (type: 'video' | 'audio', content: Record<string, unknown>): Block => ({
  id: 'media',
  pageId: 'page',
  parentBlockId: null,
  type,
  content,
  order: 0,
  createdAt: '',
  updatedAt: '',
});

let renderer: ReactTestRenderer;
beforeEach(() => {
  mockMinted = 'https://files.example/v1?sig=a';
  mockRemoved = false;
  jest.mocked(useVideoPlayer).mockClear();
  jest.mocked(useAudioPlayer).mockClear();
});
afterEach(() => act(() => renderer.unmount()));
const mount = (node: React.ReactNode) =>
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });

describe('a video block', () => {
  it('plays an uploaded video in the native player, from the URL minted for this reader', () => {
    mount(
      <VideoBlock
        block={block('video', { url: '', fileId: 'f1', name: 'demo.mp4', source: 'upload' })}
        onChangeContent={jest.fn()}
        readOnly={false}
      />,
    );
    const player = renderer.root.findByType(VideoPlayer);
    expect(player.props).toMatchObject({
      url: 'https://files.example/v1?sig=a',
      label: 'demo.mp4',
    });
    const created = jest.mocked(useVideoPlayer).mock.results[0]?.value;
    expect(created.replaceAsync).toHaveBeenCalledWith('https://files.example/v1?sig=a');
  });

  it('says an uploaded video was removed instead of playing it', () => {
    mockRemoved = true;
    mount(
      <VideoBlock
        block={block('video', { url: '', fileId: 'f1', source: 'upload' })}
        onChangeContent={jest.fn()}
        readOnly={false}
      />,
    );
    expect(renderer.root.findAllByType(VideoPlayer)).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.video.removed');
  });

  it('plays a link to a video file natively, and opens a YouTube link outside the app', () => {
    mount(
      <VideoBlock
        block={block('video', { url: 'https://cdn.example/clip.mp4', source: 'other' })}
        onChangeContent={jest.fn()}
        readOnly={false}
      />,
    );
    expect(renderer.root.findByType(VideoPlayer).props.url).toBe('https://cdn.example/clip.mp4');
    act(() =>
      renderer.update(
        <BloomTestProviders>
          <VideoBlock
            block={block('video', { url: 'https://youtu.be/abc', source: 'youtube' })}
            onChangeContent={jest.fn()}
            readOnly={false}
          />
        </BloomTestProviders>,
      ),
    );
    expect(renderer.root.findAllByType(VideoPlayer)).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'editor.blocks.video.open' }).length,
    ).toBeGreaterThan(0);
  });

  // jest cannot load the device's picker (a dynamic import), so this is the
  // path an editor sees when it cannot open: told, and the block unchanged.
  it('offers an editor an upload, and says so when the picker cannot open', async () => {
    const onChangeContent = jest.fn();
    mount(
      <VideoBlock
        block={block('video', { url: '' })}
        onChangeContent={onChangeContent}
        readOnly={false}
      />,
    );
    await act(async () => {
      const [button] = renderer.root.findAll(
        (node) => node.props.children === 'editor.blocks.upload' && Boolean(node.props.onPress),
      );
      button?.props.onPress();
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.uploadFailed');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(onChangeContent).not.toHaveBeenCalled();
  });

  it('offers a reader no upload', () => {
    mount(<VideoBlock block={block('video', { url: '' })} onChangeContent={jest.fn()} readOnly />);
    expect(
      renderer.root.findAll((node) => node.props.children === 'editor.blocks.upload'),
    ).toHaveLength(0);
  });

  it('knows the embeds of the providers it embeds', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=xyz', '')).toBe(
      'https://www.youtube.com/embed/xyz',
    );
    expect(videoEmbedUrl('https://vimeo.com/123', 'vimeo')).toBe(
      'https://player.vimeo.com/video/123',
    );
    expect(videoEmbedUrl('https://cdn.example/clip.mp4', '')).toBeNull();
  });
});

describe('an audio block', () => {
  it('plays an uploaded sound in the native player, named after its file', () => {
    mount(
      <AudioBlock
        block={block('audio', { url: '', fileId: 'f2', name: 'memo.m4a' })}
        onChangeContent={jest.fn()}
        readOnly={false}
      />,
    );
    const player = renderer.root.findByType(AudioPlayer);
    expect(player.props).toMatchObject({
      url: 'https://files.example/v1?sig=a',
      title: 'memo.m4a',
    });
    const created = jest.mocked(useAudioPlayer).mock.results[0]?.value;
    expect(created.replace).toHaveBeenCalledWith('https://files.example/v1?sig=a');
  });

  it('names a linked sound after the last part of its link', () => {
    mount(
      <AudioBlock
        block={block('audio', { url: 'https://cdn.example/sounds/rain%20loop.mp3' })}
        onChangeContent={jest.fn()}
        readOnly={false}
      />,
    );
    expect(renderer.root.findByType(AudioPlayer).props.title).toBe('rain loop.mp3');
  });
});
