import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useDraft } from '../use-draft';

let field: ReturnType<typeof useDraft>;
function Field({ value, commit }: { value: string; commit: (next: string) => void }) {
  field = useDraft(value, commit);
  return null;
}

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));

const mount = (value: string, commit = jest.fn()) => {
  act(() => {
    renderer = create(<Field value={value} commit={commit} />);
  });
  return commit;
};
const rerender = (value: string, commit: jest.Mock) =>
  act(() => renderer.update(<Field value={value} commit={commit} />));

it('commits once, when the field is left, not on every keystroke', () => {
  const commit = mount('a');
  act(() => field.onFocus());
  act(() => field.onChangeText('ab'));
  act(() => field.onChangeText('abc'));
  expect(commit).not.toHaveBeenCalled();
  act(() => field.onBlur());
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith('abc');
});

it('shows a change made elsewhere while it is not being edited', () => {
  const commit = mount('mine');
  rerender('theirs', commit);
  expect(field.value).toBe('theirs');
  // Leaving it untouched writes nothing back over it.
  act(() => field.onFocus());
  act(() => field.onBlur());
  expect(commit).not.toHaveBeenCalled();
});

it('keeps what is being typed when a change arrives meanwhile', () => {
  const commit = mount('a');
  act(() => field.onChangeText('typing'));
  rerender('remote', commit);
  expect(field.value).toBe('typing');
});
