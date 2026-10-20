import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Textarea } from '@oxy.so/bloom/textarea';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CommentComposer } from '../comment-composer';

jest.mock('../mention-picker', () => ({ MentionPicker: () => null }));
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));
const send = () =>
  renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === 'comments.composer.send' &&
      typeof node.props.onPress === 'function',
    { deep: false },
  )[0];

it('preserves a failed draft, reports the error, prevents duplicate submits, and retries', async () => {
  let reject: (error: Error) => void = () => {};
  const submit = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce(undefined);
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CommentComposer
          workspaceId="workspace"
          initialSegments={[{ text: 'Keep this draft' }]}
          onSubmit={submit}
        />
      </BloomTestProviders>,
    );
  });
  let pending: Promise<void>;
  act(() => {
    const press = send()?.props.onPress;
    pending = press();
    void press();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(Textarea).props.editable).toBe(false);
  await act(async () => {
    reject(new Error('offline'));
    await pending;
  });
  expect(renderer.root.findByType(Textarea).props.value).toBe('Keep this draft');
  expect(JSON.stringify(renderer.toJSON())).toContain('comments.composer.failed');
  await act(async () => send()?.props.onPress());
  expect(submit).toHaveBeenCalledTimes(2);
  expect(renderer.root.findByType(Textarea).props.value).toBe('');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('comments.composer.failed');
});
