import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Textarea } from '@oxy.so/bloom/textarea';
import { AppShell } from '@oxy.so/bloom/app-shell';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CommentComposer } from '../comment-composer';
import { MentionPicker } from '../mention-picker';

jest.mock('../mention-picker', () => ({ MentionPicker: () => null }));
let renderer: ReactTestRenderer;
afterEach(async () => {
  await act(async () => renderer.unmount());
});
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

function mountComposer(initialText = '') {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <CommentComposer
          workspaceId="workspace"
          initialSegments={[{ text: initialText }]}
          onSubmit={onSubmit}
        />
      </BloomTestProviders>,
    );
  });
  return onSubmit;
}
const input = () => renderer.root.findByType(Textarea);
const suggestions = () => renderer.root.findAllByType(MentionPicker);
function select(caret: number, end = caret) {
  input().props.onSelectionChange({ nativeEvent: { selection: { start: caret, end } } });
}
function change(text: string) {
  input().props.onChangeText(text);
}

it.each(['text-first', 'selection-first'] as const)(
  'opens suggestions at the first @ with %s events in one render batch',
  (order) => {
    mountComposer();
    act(() => {
      if (order === 'text-first') {
        change('@');
        select(1);
      } else {
        select(1);
        change('@');
      }
    });
    expect(suggestions()).toHaveLength(1);
    expect(suggestions()[0].props.query).toBe('');
    act(() => {
      if (order === 'text-first') {
        change('@al');
        select(3);
      } else {
        select(3);
        change('@al');
      }
    });
    expect(suggestions()[0].props.query).toBe('al');
  },
);

it('inserts a selected mention in the middle without replacing the trailing text', async () => {
  const onSubmit = mountComposer('Hi there');
  act(() => select(3));
  act(() => change('Hi @there'));
  expect(suggestions()).toHaveLength(0);
  act(() => select(4));
  expect(suggestions()[0].props.query).toBe('');
  const mention = {
    type: 'mention',
    kind: 'user',
    id: 'member',
    originalText: '@Alice',
  } as const;
  act(() => suggestions()[0].props.onSelect(mention));
  expect(input().props.value).toBe('Hi @Alice there');
  act(() => select(6));
  expect(suggestions()).toHaveLength(0);
  await act(async () => send()?.props.onPress());
  expect(onSubmit).toHaveBeenCalledWith([
    { type: 'text', text: 'Hi ' },
    mention,
    { type: 'text', text: ' there' },
  ]);
});

it('keeps Escape dismissed across selection notifications and permits the next typed query', () => {
  mountComposer();
  act(() => {
    change('@');
    select(1);
  });
  act(() => input().props.onKeyPress({ nativeEvent: { key: 'Escape' } }));
  act(() => select(1));
  expect(suggestions()).toHaveLength(0);
  act(() => {
    change('@a');
    select(2);
  });
  expect(suggestions()[0].props.query).toBe('a');
  act(() => select(0, 2));
  expect(suggestions()).toHaveLength(0);
});

it.each(['person@', 'person@example.com', 'Hello person@example.com'])(
  'does not treat an email token as a mention: %s',
  (value) => {
    mountComposer();
    act(() => {
      change(value);
      select(value.length);
    });
    expect(suggestions()).toHaveLength(0);
  },
);

it('retains text and mention ranges in the panel session when its presentation remounts', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const mention = {
    type: 'mention' as const,
    kind: 'user' as const,
    id: 'member-1',
    originalText: '@Ana',
  };
  const fixture = (generation: number, sessionKey = 'page:one:comment') => (
    <BloomTestProviders>
      <AppShell
        panelLayout={{
          panels: [
            {
              id: 'comments',
              content: (
                <CommentComposer
                  key={generation}
                  sessionKey={sessionKey}
                  workspaceId="workspace"
                  initialSegments={[mention, { type: 'text', text: ' hello' }]}
                  onSubmit={onSubmit}
                />
              ),
            },
          ],
        }}
      />
    </BloomTestProviders>
  );
  act(() => {
    renderer = create(fixture(0));
  });
  act(() => input().props.onChangeText('@Ana hello from draft'));
  act(() => renderer.update(fixture(1)));
  expect(input().props.value).toBe('@Ana hello from draft');
  await act(async () => send()?.props.onPress());
  expect(onSubmit).toHaveBeenCalledWith([mention, { type: 'text', text: ' hello from draft' }]);
  expect(input().props.value).toBe('');
  act(() => renderer.update(fixture(2, 'page:two:comment')));
  expect(input().props.value).toBe('@Ana hello');
});

it('keeps an in-flight submission locked across a panel content remount', async () => {
  let finish: () => void = () => {};
  const onSubmit = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const fixture = (generation: number) => (
    <BloomTestProviders>
      <AppShell
        panelLayout={{
          panels: [
            {
              id: 'comments',
              content: (
                <CommentComposer
                  key={generation}
                  sessionKey="pending-comment"
                  workspaceId="workspace"
                  initialSegments={[{ type: 'text', text: 'one submission' }]}
                  onSubmit={onSubmit}
                />
              ),
            },
          ],
        }}
      />
    </BloomTestProviders>
  );
  act(() => {
    renderer = create(fixture(0));
  });
  let pending: Promise<void>;
  act(() => {
    pending = send()?.props.onPress();
  });
  act(() => renderer.update(fixture(1)));
  expect(input().props.editable).toBe(false);
  act(() => {
    void send()?.props.onPress();
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await pending;
  });
  expect(input().props.value).toBe('');
  expect(input().props.editable).toBe(true);
});

it.each(['cancel', 'save'] as const)(
  'starts a new seeded composer lifetime from current segments after %s',
  async (finish) => {
    const onCancel = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const fixture = (visible: boolean, seed: string) => (
      <BloomTestProviders>
        <AppShell
          panelLayout={{
            panels: [
              {
                id: 'comments',
                content: visible ? (
                  <CommentComposer
                    sessionKey="seeded-comment"
                    workspaceId="workspace"
                    initialSegments={[{ type: 'text', text: seed }]}
                    onCancel={onCancel}
                    onSubmit={onSubmit}
                  />
                ) : null,
              },
            ],
          }}
        />
      </BloomTestProviders>
    );
    act(() => {
      renderer = create(fixture(true, 'Original text'));
    });
    act(() => input().props.onChangeText('Changed draft'));
    if (finish === 'save') await act(async () => send()?.props.onPress());
    else
      act(() =>
        renderer.root
          .findAll(
            (node) =>
              node.props.accessibilityLabel === 'common.cancel' &&
              typeof node.props.onPress === 'function',
            { deep: false },
          )[0]
          .props.onPress(),
      );
    act(() => renderer.update(fixture(false, 'Server text')));
    act(() => renderer.update(fixture(true, 'Server text')));
    expect(input().props.value).toBe('Server text');
  },
);

it.each(['plain', 'mention'])(
  'retains the second %s draft after submit and presentation remount',
  async (kind) => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const fixture = (generation: number) => (
      <BloomTestProviders>
        <AppShell
          panelLayout={{
            panels: [
              {
                id: 'comments',
                content: (
                  <CommentComposer
                    key={generation}
                    sessionKey="second-draft"
                    workspaceId="workspace"
                    onSubmit={onSubmit}
                  />
                ),
              },
            ],
          }}
        />
      </BloomTestProviders>
    );
    act(() => {
      renderer = create(fixture(0));
    });
    act(() => change('First comment'));
    await act(async () => send()?.props.onPress());
    expect(input().props.value).toBe('');
    const mention = {
      type: 'mention',
      kind: 'user',
      id: 'member-2',
      originalText: '@Bea',
    } as const;
    if (kind === 'mention') {
      act(() => {
        change('@');
        select(1);
      });
      act(() => suggestions()[0].props.onSelect(mention));
    }
    const draft = kind === 'mention' ? '@Bea second draft' : 'Second draft';
    act(() => change(draft));
    act(() => renderer.update(fixture(1)));
    expect(input().props.value).toBe(draft);
    await act(async () => send()?.props.onPress());
    expect(onSubmit).toHaveBeenNthCalledWith(
      2,
      kind === 'mention'
        ? [mention, { type: 'text', text: ' second draft' }]
        : [{ type: 'text', text: 'Second draft' }],
    );
  },
);
