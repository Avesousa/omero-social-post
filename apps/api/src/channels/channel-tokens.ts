import { type TokenCipher } from '../crypto/token-cipher.service';
import { type channels } from '../db/schema';
import { type TokenSet } from '../providers';

export type ChannelRow = typeof channels.$inferSelect;

/** The token columns of a `channels` row, as written by connect and refresh. */
export type TokenColumns = Pick<
  typeof channels.$inferInsert,
  'accessTokenEnc' | 'refreshTokenEnc' | 'tokenExpiresAt' | 'refreshExpiresAt' | 'scopes'
>;

/** Encrypts a token set for storage. `fallbackScopes` is used when the network returned none. */
export function encryptTokens(
  cipher: TokenCipher,
  tokens: TokenSet,
  fallbackScopes: readonly string[] = [],
): Required<TokenColumns> {
  return {
    accessTokenEnc: cipher.encrypt(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? cipher.encrypt(tokens.refreshToken) : null,
    tokenExpiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
    scopes: tokens.scopes.length > 0 ? tokens.scopes : [...fallbackScopes],
  };
}

/** Decrypts the stored tokens, or returns null when the row holds none (disconnected). */
export function decryptTokens(cipher: TokenCipher, row: ChannelRow): TokenSet | null {
  if (!row.accessTokenEnc) return null;
  return {
    accessToken: cipher.decrypt(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? cipher.decrypt(row.refreshTokenEnc) : undefined,
    expiresAt: row.tokenExpiresAt ?? undefined,
    refreshExpiresAt: row.refreshExpiresAt ?? undefined,
    scopes: row.scopes,
  };
}
