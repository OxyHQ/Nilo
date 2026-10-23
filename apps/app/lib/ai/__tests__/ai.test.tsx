import { OxyInferenceError } from '@oxy.so/core/inference';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { answerText, instructionFor, MAX_INPUT_CHARS, messagesFor } from '../actions';
import { AI_POWER_LEVEL, failureOf, useAiAction, useAiAvailable } from '../use-ai';

const mockClient = { listRoutingProfiles: jest.fn(), respond: jest.fn() };
let mockAccount = 'account-a';
let mockEpoch = 1;
let mockPolicyRevision = 1;
const mockServices = { http: { getSessionEpoch: () => mockEpoch } };
let mockAuthenticated = true;
jest.mock('@oxy.so/core/inference', () => {
  const actual = jest.requireActual('@oxy.so/core/inference');
  return { ...actual, createInferenceClient: () => mockClient };
});
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({
    isAuthenticated: mockAuthenticated,
    canUsePrivateApi: mockAuthenticated,
    user: { id: mockAccount, kind: 'personal' },
    activeSessionId: `session-${mockAccount}`,
    oxyServices: mockServices,
  }),
  useSupervision: () => ({ dataUpdatedAt: mockPolicyRevision }),
}));

const refusal = (code: string, retryable: boolean) =>
  new OxyInferenceError({
    code: code as never,
    message: code,
    retryable,
    requestId: 'req-1',
    status: 400,
  });

describe('the actions', () => {
  it("asks for the result alone, as Markdown, in the text's own language", () => {
    for (const action of [
      'improve',
      'fixSpelling',
      'shorter',
      'longer',
      'simplify',
      'summarize',
    ] as const) {
      const instruction = instructionFor(action);
      expect(instruction).toContain('Answer with the result only, as Markdown');
      expect(instruction).toContain('same language as the text');
    }
    expect(instructionFor('translate', 'ja')).toContain('into Japanese');
    expect(instructionFor('translate', 'ja')).not.toContain('same language');
  });

  it("sends the instruction as the system message and the text as the member's", () => {
    const [system, user] = messagesFor('summarize', 'Long text');
    expect(system).toMatchObject({ role: 'system', content: [{ type: 'text' }] });
    expect(user).toEqual({ role: 'user', content: [{ type: 'text', text: 'Long text' }] });
  });

  it('reads only what the assistant wrote', () => {
    expect(
      answerText([
        { role: 'user', content: [{ type: 'text', text: 'ignored' }] },
        { role: 'assistant', content: [{ type: 'text', text: ' Hello ' }, { type: 'image' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
      ]),
    ).toBe('Hello world');
  });
});

describe('edge refusals, as the member can act on them', () => {
  it('reads the code and whether it may be retried, never the status', () => {
    expect(failureOf(refusal('rate_limited', true))).toEqual({
      kind: 'tryLater',
      requestId: 'req-1',
    });
    expect(failureOf(refusal('insufficient_balance', false))).toEqual({
      kind: 'account',
      requestId: 'req-1',
    });
    expect(failureOf(refusal('context_length_exceeded', false))).toEqual({ kind: 'tooLong' });
    expect(failureOf(refusal('policy_violation', false))).toEqual({
      kind: 'unavailable',
      requestId: 'req-1',
    });
    expect(failureOf(new Error('network'))).toEqual({ kind: 'unavailable' });
  });
});

let available: boolean;
let action: ReturnType<typeof useAiAction>;
function Probe() {
  available = useAiAvailable();
  action = useAiAction();
  return null;
}
let renderer: ReactTestRenderer | undefined;
const clients: QueryClient[] = [];
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  // Let the current account catalogue arrive.
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticated = true;
  process.env.EXPO_PUBLIC_OXY_CLIENT_ID = 'nilo-client';
  mockAccount = 'account-a';
  mockEpoch = 1;
  mockPolicyRevision = 1;
  mockClient.listRoutingProfiles.mockResolvedValue([{ slug: 'instant' }, { slug: 'high' }]);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  for (const client of clients.splice(0)) {
    // MutationCache.clear removes entries but does not cancel their GC timers.
    for (const mutation of client.getMutationCache().getAll()) mutation.destroy();
    client.clear();
  }
});

describe('running an action', () => {
  it('is offered from the signed-in account catalogue without application scope metadata', async () => {
    await mount();
    expect(available).toBe(true);
    expect(mockClient.listRoutingProfiles).toHaveBeenCalledTimes(1);
  });

  it('does not reuse another account or session catalogue, and refreshes after a policy change', async () => {
    await mount();
    expect(available).toBe(true);
    mockAccount = 'account-b';
    mockEpoch++;
    mockClient.listRoutingProfiles.mockResolvedValue([]);
    const queryClient = clients.at(-1);
    if (!queryClient) throw new Error('Missing mounted query client');
    const refresh = async () => {
      await act(async () =>
        renderer?.update(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>,
        ),
      );
      for (let i = 0; i < 3; i++)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
    };
    await refresh();
    expect(available).toBe(false);
    mockClient.listRoutingProfiles.mockResolvedValue([{ slug: 'instant' }]);
    mockPolicyRevision++;
    await refresh();
    expect(available).toBe(true);
    expect(mockClient.listRoutingProfiles).toHaveBeenCalledTimes(3);
  });

  it('is not offered when the edge lists nothing, or before signing in', async () => {
    mockClient.listRoutingProfiles.mockResolvedValue([]);
    await mount();
    expect(available).toBe(false);
    act(() => renderer?.unmount());
    jest.clearAllMocks();
    mockAuthenticated = false;
    await mount();
    expect(available).toBe(false);
    expect(mockClient.listRoutingProfiles).not.toHaveBeenCalled();
  });

  it('names the power level and nothing else, and answers with the text', async () => {
    mockClient.respond.mockResolvedValue({
      requestId: 'r',
      output: [{ role: 'assistant', content: [{ type: 'text', text: '- one\n- two' }] }],
    });
    await mount();
    let result = '';
    await act(async () => {
      result = await action.mutateAsync({ action: 'summarize', text: '  page text  ' });
    });
    expect(result).toBe('- one\n- two');
    const [request] = mockClient.respond.mock.calls[0];
    expect(Object.keys(request).sort()).toEqual(['input', 'routingProfile']);
    expect(request.routingProfile).toBe(AI_POWER_LEVEL);
    expect(request.input[1].content[0].text).toBe('page text');
  });

  it('sends nothing for empty or overlong text', async () => {
    await mount();
    for (const text of ['   ', 'x'.repeat(MAX_INPUT_CHARS + 1)]) {
      await act(async () => {
        await action.mutateAsync({ action: 'improve', text }).catch(() => undefined);
      });
    }
    expect(mockClient.respond).not.toHaveBeenCalled();
  });
});
