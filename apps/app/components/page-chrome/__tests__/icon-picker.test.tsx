import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EmojiPicker, type EmojiPickerProps } from '@oxy.so/bloom/chat-composer';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { Button } from '@oxy.so/bloom/button';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { IconPicker } from '../icon-picker';
import { PageImageUpload } from '../page-image-upload';
import { EMOJI_CATEGORIES } from '../emoji-data';
import { PAGE_ICONS } from '../page-icons';

// Overlay animation is outside this adapter test; the actual Bloom picker,
// controls, filtering and tab selection remain mounted.
jest.mock('@oxy.so/bloom/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../page-image-upload', () => ({ PageImageUpload: () => null }));
let renderer: ReactTestRenderer;
const close = jest.fn();
const onSelect = jest.fn();
const control = { close } as unknown as DialogControlProps;
async function mount(
  props: { pageId?: string; variant?: 'page' | 'callout' } = { pageId: 'page' },
) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <IconPicker control={control} onSelect={onSelect} {...props} />
      </BloomTestProviders>,
    );
  });
}
function pickerProps(): EmojiPickerProps {
  return renderer.root.findByType(EmojiPicker).props as EmojiPickerProps;
}
function tab(label: string) {
  const node = renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
    { deep: false },
  )[0];
  expect(node).toBeDefined();
  return node;
}

beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  await act(async () => renderer?.unmount());
});

it('delegates the full catalog, search and skin tone selection to Bloom and encodes its result', async () => {
  await mount();
  expect(pickerProps().groups.flatMap((group) => group.emojis)).toHaveLength(
    EMOJI_CATEGORIES.flatMap((group) => group.emojis).length,
  );
  expect(pickerProps().groups[0].emojis[0]).toEqual({
    char: '😀',
    name: 'grinning',
    keywords: ['grinning', 'face', 'smile', 'happy'],
  });
  expect(pickerProps().columns).toBeUndefined();
  expect(pickerProps().height).toBeUndefined();
  expect(pickerProps().style).toBeUndefined();
  expect(renderer.root.findByType(Dialog).props.scrollable).not.toBe(false);
  expect(pickerProps().embedded).toBe(true);
  expect(pickerProps().scrollable).toBe(false);
  act(() => pickerProps().onSelectEmoji?.('👋🏽'));
  expect(onSelect).toHaveBeenCalledWith('emoji:👋🏽');
  expect(close).toHaveBeenCalledTimes(1);
});

it('retains the named icon catalog and selection in the public custom tab', async () => {
  await mount();
  act(() => tab('pages.iconPicker.tabs.icon')?.props.onPress());
  const search = renderer.root.findByType(TextFieldInput);
  act(() => search.props.onChangeText(PAGE_ICONS[0].name));
  const icon = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === PAGE_ICONS[0].name &&
      typeof node.props.onPress === 'function',
    { deep: false },
  )[0];
  expect(icon).toBeDefined();
  act(() => icon?.props.onPress());
  expect(onSelect).toHaveBeenCalledWith(`icon:${PAGE_ICONS[0].name}`);
  expect(close).toHaveBeenCalledTimes(1);
});

it('retains page-scoped uploads and file encoding', async () => {
  await mount();
  act(() => tab('pages.iconPicker.tabs.upload')?.props.onPress());
  const upload = renderer.root.findByType(PageImageUpload);
  expect(upload.props.pageId).toBe('page');
  act(() => upload.props.onUploaded('attached-file'));
  expect(onSelect).toHaveBeenCalledWith('file:attached-file');
  expect(close).toHaveBeenCalledTimes(1);
});

it('supports image links without granting uploads when no page owns the file', async () => {
  await mount({});
  act(() => tab('pages.iconPicker.tabs.upload')?.props.onPress());
  expect(renderer.root.findAllByType(PageImageUpload)).toHaveLength(0);
  const search = renderer.root.findByType(TextFieldInput);
  const useImage = () =>
    renderer.root
      .findAllByType(Button)
      .find((node) => node.props.accessibilityLabel === 'pages.iconPicker.useImage');
  act(() => search.props.onChangeText('javascript:alert(1)'));
  act(() => useImage()?.props.onPress());
  expect(onSelect).not.toHaveBeenCalled();
  act(() => search.props.onChangeText(' https://example.test/image.png '));
  act(() => useImage()?.props.onPress());
  expect(onSelect).toHaveBeenCalledWith('image:https://example.test/image.png');
});

it('keeps removal for pages and excludes removal and upload for callouts', async () => {
  await mount();
  const action = renderer.root
    .findByType(Dialog)
    .props.header.actions.find(
      (item: { accessibilityLabel: string }) =>
        item.accessibilityLabel === 'pages.iconPicker.removeIcon',
    );
  act(() => action.onPress());
  expect(onSelect).toHaveBeenCalledWith(null);
  act(() => renderer.unmount());
  await mount({ variant: 'callout' });
  expect(pickerProps().tabs?.map((entry) => entry.key)).toEqual(['icon']);
  const actions = renderer.root.findByType(Dialog).props.header.actions;
  expect(actions).toHaveLength(1);
  expect(actions[0].accessibilityLabel).toBe('pages.iconPicker.randomEmoji');
  act(() => actions[0].onPress());
  expect(onSelect).toHaveBeenLastCalledWith(expect.stringMatching(/^emoji:/));
});
