/**
 * Values of the `error` query parameter on `/settings/channels?error=<code>` after a
 * failed connect. The web maps each one to a message.
 */
export const CONNECT_ERROR = {
  /** The owner cancelled on the consent screen (or the network reported access_denied). */
  accessDenied: 'access_denied',
  /** The network reported another error on its side. */
  providerError: 'provider_error',
  /** Missing, unknown, expired or already used `state`. Start the connection again. */
  stateInvalid: 'state_invalid',
  /** The `state` belongs to another session or provider. Start the connection again. */
  stateMismatch: 'state_mismatch',
  /** The callback came without an authorization code. */
  missingCode: 'missing_code',
  /** The network rejected the code exchange (expired or reused code, bad credentials). */
  exchangeFailed: 'exchange_failed',
  /** The tokens were issued but the profile could not be read. */
  profileFailed: 'profile_failed',
  /** The provider's client id and secret are not set in env. */
  notConfigured: 'not_configured',
  /** Anything unexpected (details are in the server log only). */
  unknown: 'unknown',
} as const;

export type ConnectError = (typeof CONNECT_ERROR)[keyof typeof CONNECT_ERROR];

/** Provider-side `error` values that mean "the owner said no" (X and LinkedIn spellings). */
const DENIED = new Set(['access_denied', 'user_cancelled_authorize', 'user_cancelled_login']);

export function connectErrorFromProvider(error: string): ConnectError {
  return DENIED.has(error) ? CONNECT_ERROR.accessDenied : CONNECT_ERROR.providerError;
}
