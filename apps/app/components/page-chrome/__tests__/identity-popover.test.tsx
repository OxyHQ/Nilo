import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { Popover } from '@oxy.so/bloom/popover';
import { Button } from '@oxy.so/bloom/button';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { IdentityPopover } from '../identity-popover';

// Only replace overlay positioning/portaling: the actual form, controls, state
// and asynchronous save contract run unchanged in this native renderer.
jest.mock('@oxy.so/bloom/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => children,
  PopoverContent: ({ children }: { children: React.ReactNode }) => children,
}));

let renderer: ReactTestRenderer;
let onSave: jest.Mock<Promise<unknown>, [string]>;
let onChooseIcon: jest.Mock;
function tree(title = 'Original') {
  return (
    <BloomTestProviders>
      <IdentityPopover title={title} icon={null} onSave={onSave} onChooseIcon={onChooseIcon}>
        {null}
      </IdentityPopover>
    </BloomTestProviders>
  );
}
const popover = () => renderer.root.findByType(Popover);
const input = () => renderer.root.findByType(TextInput);
const iconButton = () => renderer.root.findByType(Button);
function open() {
  act(() => popover().props.onOpenChange(true));
}
function edit(value = 'My draft') {
  act(() => input().props.onChangeText(value));
}
function deferredSave() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  onSave.mockReturnValue(
    new Promise((accept, refuse) => {
      resolve = accept;
      reject = refuse;
    }),
  );
  return { resolve, reject };
}
beforeEach(async () => {
  onSave = jest.fn().mockResolvedValue(undefined);
  onChooseIcon = jest.fn();
  await act(async () => {
    renderer = create(tree());
  });
  await act(async () => popover().props.onOpenChange(true));
});
afterEach(() => act(() => renderer.unmount()));

it('deduplicates Enter and outside close while saving', async () => {
  const request = deferredSave();
  edit();
  await act(async () => {
    input().props.onSubmitEditing();
    popover().props.onOpenChange(false);
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith('My draft');
  expect(popover().props.open).toBe(true);
  expect(input().props.editable).toBe(false);
  await act(async () => request.resolve());
  expect(popover().props.open).toBe(false);
});

it('saves an outside dismissal and closes unchanged fields without saving', async () => {
  await act(async () => popover().props.onOpenChange(false));
  expect(onSave).not.toHaveBeenCalled();
  open();
  edit();
  await act(async () => popover().props.onOpenChange(false));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(popover().props.open).toBe(false);
});

it('keeps a failed draft open and retries, including an optimistic prop update', async () => {
  const request = deferredSave();
  edit();
  await act(async () => input().props.onSubmitEditing());
  act(() => renderer.update(tree('My draft')));
  await act(async () => request.reject(new Error('Offline')));
  expect(popover().props.open).toBe(true);
  expect(input().props.value).toBe('My draft');
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.header.renameFailed');
  onSave.mockResolvedValue(undefined);
  await act(async () => input().props.onSubmitEditing());
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(popover().props.open).toBe(false);
});

it('cancels on Escape without saving or bubbling into overlay dismissal', () => {
  edit();
  const event = {
    nativeEvent: { key: 'Escape' },
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
  act(() => input().props.onKeyPress(event));
  expect(onSave).not.toHaveBeenCalled();
  expect(popover().props.open).toBe(false);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
  open();
  expect(input().props.value).toBe('Original');
});

it('updates untouched metadata but never replaces a draft on remote rename or duplicate open', () => {
  act(() => renderer.update(tree('Remote')));
  expect(input().props.value).toBe('Remote');
  edit();
  act(() => renderer.update(tree('Another remote')));
  open();
  expect(input().props.value).toBe('My draft');
});

it('also cancels Escape while the icon action has keyboard focus', () => {
  edit();
  const event = {
    nativeEvent: { key: 'Escape' },
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
  act(() => iconButton().props.onKeyDown(event));
  expect(onSave).not.toHaveBeenCalled();
  expect(onChooseIcon).not.toHaveBeenCalled();
  expect(popover().props.open).toBe(false);
  expect(event.stopPropagation).toHaveBeenCalled();
});

it('opens the icon picker once, after a successful save', async () => {
  const request = deferredSave();
  edit();
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = iconButton().props.onPress();
    second = iconButton().props.onPress();
  });
  expect(onChooseIcon).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenCalledTimes(1);
  await act(async () => {
    request.resolve();
    await Promise.all([first, second]);
  });
  expect(onChooseIcon).toHaveBeenCalledTimes(1);
  expect(popover().props.open).toBe(false);
});

it('does not open the icon picker when saving fails and preserves the retry', async () => {
  onSave.mockRejectedValueOnce(new Error('Offline'));
  edit();
  await act(async () => iconButton().props.onPress());
  expect(onChooseIcon).not.toHaveBeenCalled();
  expect(popover().props.open).toBe(true);
  expect(input().props.value).toBe('My draft');
  await act(async () => iconButton().props.onPress());
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onChooseIcon).toHaveBeenCalledTimes(1);
});

it('ignores late completion after unmount and never opens an orphan icon picker', async () => {
  const request = deferredSave();
  edit();
  let pending!: Promise<void>;
  await act(async () => {
    pending = iconButton().props.onPress();
  });
  act(() => renderer.unmount());
  await act(async () => {
    request.resolve();
    await pending;
  });
  expect(onChooseIcon).not.toHaveBeenCalled();
});

it('does not start a deferred save after unmount', async () => {
  edit();
  act(() => {
    input().props.onSubmitEditing();
    renderer.unmount();
  });
  await act(async () => {});
  expect(onSave).not.toHaveBeenCalled();
});
