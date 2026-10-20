import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { BlockMenuButton } from '../block-menu-button';
import { SizedImage } from '../image-block';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
jest.mock('@/lib/files/file-urls', () => ({}));
jest.mock('@/lib/files/upload-page-file', () => ({}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { percent?: number }) =>
      options?.percent === undefined ? key : `${key}:${options.percent}`,
  }),
}));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
const source = { uri: 'https://cdn.example/a.png' };

/** The box the picture is drawn in, laid out in a frame `frame` wide. */
function box(frame: number) {
  const outer = renderer.root.findAllByType(View).find((node) => node.props.onLayout);
  act(() => outer?.props.onLayout({ nativeEvent: { layout: { width: frame, height: 0 } } }));
  return renderer.root
    .findAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style))
    .find((style) => style?.alignSelf !== undefined);
}

it('draws the picture at its width and alignment', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <SizedImage source={source} alt="Plan" width={300} alignment="right" readOnly />
      </BloomTestProviders>,
    );
  });
  expect(box(700)).toMatchObject({ alignSelf: 'flex-end', width: 300 });
  // Readers get no options.
  expect(renderer.root.findAllByType(BlockMenuButton)).toHaveLength(0);
});

it('gives an editor sizes, alignments and alt text, stored as the block content', () => {
  const onChange = jest.fn();
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <SizedImage
          source={source}
          alt={undefined}
          width={undefined}
          alignment="center"
          readOnly={false}
          onChange={onChange}
        />
      </BloomTestProviders>,
    );
  });
  expect(box(800)).toMatchObject({ alignSelf: 'center', width: 800 });
  const entries = renderer.root.findByType(BlockMenuButton).props.entries as {
    label?: string;
    onPress?: () => void;
    onChange?: () => void;
  }[];
  const entry = (label: string) => entries.find((candidate) => candidate.label === label);
  act(() => entry('editor.blocks.image.size:50')?.onPress?.());
  expect(onChange).toHaveBeenLastCalledWith({ width: 400 });
  act(() => entry('editor.blocks.image.size:100')?.onPress?.());
  expect(onChange).toHaveBeenLastCalledWith({ width: undefined });
  act(() => entry('editor.blocks.image.align.left')?.onChange?.());
  expect(onChange).toHaveBeenLastCalledWith({ alignment: 'left' });
  expect(entry('editor.blocks.image.altText')).toBeDefined();
});
