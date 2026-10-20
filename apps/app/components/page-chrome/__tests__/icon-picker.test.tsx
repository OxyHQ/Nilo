import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { DialogControlProps } from '@oxy.so/bloom/dialog';
import { Button } from '@oxy.so/bloom/button';
import { EmojiPicker } from '@oxy.so/bloom/chat-composer';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { IconPicker } from '../icon-picker';
import { PageImageUpload } from '../page-image-upload';

// The dialog's portal/animation boundary is tested by Bloom. Render its body
// in place so these tests exercise Nilo's data, actions and variant constraints.
jest.mock('@oxy.so/bloom/dialog', () => ({
  ...jest.requireActual('@oxy.so/bloom/dialog'),
  Dialog: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../page-image-upload', () => ({ PageImageUpload: () => null }));

const control: DialogControlProps = {
  id: 'icon-picker',
  ref: React.createRef<NonNullable<DialogControlProps['ref']['current']>>(),
  open: jest.fn(),
  close: jest.fn(),
};
let renderer: ReactTestRenderer;
const select = jest.fn();
function mount(variant: 'page' | 'callout' = 'page') {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <IconPicker control={control} onSelect={select} pageId="page" variant={variant} />
      </BloomTestProviders>,
    );
  });
}
function picker() {
  return renderer.root.findByType(EmojiPicker);
}
function action(label: string) {
  const node = renderer.root
    .findAllByType(Button)
    .find((node) => node.props.accessibilityLabel === label);
  if (!node) throw new Error(`Missing action: ${label}`);
  return node;
}
afterEach(() => {
  act(() => renderer.unmount());
  jest.clearAllMocks();
});

it('uses the complete flow picker with localized app data and closes on emoji selection', () => {
  mount();
  expect(picker().props).toMatchObject({ embedded: true, scrollable: false, columns: 'auto' });
  expect(picker().props.size).toBeUndefined();
  expect(picker().props.groups[0].emojis[0]).toMatchObject({
    char: '😀',
    keywords: expect.any(Array),
  });
  expect(picker().props.labels.search).toBe('pages.iconPicker.searchEmojis');
  act(() => picker().props.onSelectEmoji('👍🏽'));
  expect(select).toHaveBeenCalledWith('emoji:👍🏽');
  expect(control.close).toHaveBeenCalledTimes(1);
});

it('searches icon data and stores the selected icon name', () => {
  mount();
  act(() => picker().props.onActiveTabChange('icon'));
  const field = renderer.root
    .findAllByType(TextFieldInput)
    .find((node) => node.props.label === 'pages.iconPicker.searchIcons');
  if (!field) throw new Error('Missing icon search');
  act(() => field.props.onChangeText('star'));
  const iconButtons = renderer.root.findAllByType(Button).filter((node) => node.props.iconOnly);
  expect(iconButtons.length).toBeGreaterThan(0);
  expect(iconButtons.some((node) => node.props.accessibilityLabel === 'star')).toBe(true);
  act(() => action('star').props.onPress());
  expect(select).toHaveBeenCalledWith('icon:star');
});

it('validates image links and preserves uploaded file ownership', () => {
  mount();
  act(() => picker().props.onActiveTabChange('upload'));
  const field = renderer.root
    .findAllByType(TextFieldInput)
    .find((node) => node.props.label === 'pages.iconPicker.linkHint');
  if (!field) throw new Error('Missing image URL field');
  act(() => field.props.onChangeText('javascript:alert(1)'));
  act(() => action('pages.iconPicker.useImage').props.onPress());
  expect(select).not.toHaveBeenCalled();
  act(() => field.props.onChangeText(' https://example.test/icon.png '));
  act(() => action('pages.iconPicker.useImage').props.onPress());
  expect(select).toHaveBeenCalledWith('image:https://example.test/icon.png');
  const upload = renderer.root.findByType(PageImageUpload);
  expect(upload.props.pageId).toBe('page');
  act(() => upload.props.onUploaded('file-id'));
  expect(select).toHaveBeenCalledWith('file:file-id');
});

it('keeps removal and random selection available for pages', () => {
  mount();
  act(() => action('pages.iconPicker.randomEmoji').props.onPress());
  expect(select).toHaveBeenCalledWith(expect.stringMatching(/^emoji:/));
  act(() => action('pages.iconPicker.removeIcon').props.onPress());
  expect(select).toHaveBeenCalledWith(null);
});

it('prevents upload and clearing after a page picker becomes a callout picker', () => {
  mount();
  act(() => picker().props.onActiveTabChange('upload'));
  act(() =>
    renderer.update(
      <BloomTestProviders>
        <IconPicker control={control} onSelect={select} variant="callout" />
      </BloomTestProviders>,
    ),
  );
  expect(picker().props.activeTab).toBe('__emoji');
  expect(picker().props.tabs.map((tab: { key: string }) => tab.key)).toEqual(['icon']);
  expect(
    renderer.root
      .findAllByType(Button)
      .some((node) => node.props.accessibilityLabel === 'pages.iconPicker.removeIcon'),
  ).toBe(false);
  expect(renderer.root.findAllByType(PageImageUpload)).toHaveLength(0);
  act(() => picker().props.onActiveTabChange('upload'));
  expect(picker().props.activeTab).toBe('__emoji');
  expect(select).not.toHaveBeenCalled();
});
