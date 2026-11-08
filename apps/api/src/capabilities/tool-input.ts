/** What the Nilo and memory tool handlers share: the refusal they throw and how they read an input. */

export class NiloCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NiloCapabilityError';
  }
}

export type Input = Readonly<Record<string, unknown>>;
export type ToolExecutor = (input: Input, userId: string) => Promise<Record<string, unknown>>;

export function invalid(message: string): never {
  throw new NiloCapabilityError('invalid_input', message, 400);
}

export function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) invalid(`${key} is required`);
  return value;
}

export function optionalString(input: Input, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const limitOf = (input: Input, fallback = 50) =>
  typeof input.limit === 'number' ? input.limit : fallback;
