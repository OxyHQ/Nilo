/**
 * What a Nilo call can fail with. Every failure is a `NiloError`; one the API
 * answered is a `NiloApiError` carrying its code (`CALENDAR_ERROR_CODES`), so
 * callers branch on `error.code`, never on the message.
 */
import type { CalendarErrorCode } from '@oxy.so/nilo-contracts';

export class NiloError extends Error {
  override name = 'NiloError';
}

/** The API answered with an error: `code` says which, `status` is the HTTP status. */
export class NiloApiError extends NiloError {
  override name = 'NiloApiError';
  constructor(
    readonly code: CalendarErrorCode,
    message: string,
    readonly status: number,
    readonly details: Readonly<Record<string, string | number | boolean | null>> = {},
    /** Seconds to wait before retrying, for `rate_limited`. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

/** The request never got an answer: the network failed, or the call was aborted. */
export class NiloNetworkError extends NiloError {
  override name = 'NiloNetworkError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** The request took longer than the client's `timeoutMs`. */
export class NiloTimeoutError extends NiloError {
  override name = 'NiloTimeoutError';
}

/**
 * The answer was not what the contract says: a different API version, or a
 * proxy in the way. Never a reason to drop what the caller holds.
 */
export class NiloResponseError extends NiloError {
  override name = 'NiloResponseError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The input was refused before it was sent: it does not fit the contract. */
export class NiloValidationError extends NiloError {
  override name = 'NiloValidationError';
  constructor(
    message: string,
    readonly field: string | null,
  ) {
    super(message);
  }
}
