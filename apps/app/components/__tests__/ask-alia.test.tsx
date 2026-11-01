import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AskAliaRoot, useAskAlia } from '../ask-alia';

let mockCanUsePrivateApi = true;
const mockPresent = jest.fn();
const mockSignIn = jest.fn(async () => {});

jest.mock('@oxy.so/services/ui/client', () => ({
  useAuth: () => ({ canUsePrivateApi: mockCanUsePrivateApi, signIn: mockSignIn }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@alia.onl/sdk', () => {
  const React = require('react');
  return {
    AliaChatSheet: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ present: mockPresent }));
      return React.createElement('AliaSheetFixture', props);
    }),
  };
});

let ask: () => void;
let renderer: ReactTestRenderer;
function Probe() {
  ask = useAskAlia();
  return null;
}
function tree() {
  return (
    <AskAliaRoot>
      <Probe />
    </AskAliaRoot>
  );
}

beforeEach(() => {
  mockCanUsePrivateApi = true;
  jest.clearAllMocks();
});
afterEach(() => act(() => renderer.unmount()));

it('opens the sheet with the workspace context and translated suggestions', () => {
  act(() => {
    renderer = create(tree());
  });
  const sheet = renderer.root.findByType('AliaSheetFixture' as never);
  expect(sheet.props.clientContext).toBe('alia.clientContext');
  expect(sheet.props.welcomeSuggestions).toEqual([
    { id: 'write', text: 'alia.suggestion.write' },
    { id: 'organise', text: 'alia.suggestion.organise' },
    { id: 'database', text: 'alia.suggestion.database' },
  ]);
  act(() => ask());
  expect(mockPresent).toHaveBeenCalledTimes(1);
  expect(mockSignIn).not.toHaveBeenCalled();
});

it('requests sign-in without leaving a sheet mounted when the session is unavailable', () => {
  act(() => {
    renderer = create(tree());
  });
  mockCanUsePrivateApi = false;
  act(() => renderer.update(tree()));
  expect(renderer.root.findAllByType('AliaSheetFixture' as never)).toHaveLength(0);
  act(() => ask());
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockPresent).not.toHaveBeenCalled();
});
