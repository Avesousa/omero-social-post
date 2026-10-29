import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Version written by `encrypt`. Bump it (and add a key) to rotate ENCRYPTION_KEY. */
const CURRENT_VERSION = 'v1';

/** Raised for any ciphertext that cannot be authenticated or parsed. Never includes secrets. */
export class TokenDecryptionError extends Error {
  constructor(reason: string) {
    super(`Cannot decrypt token: ${reason}`);
    this.name = 'TokenDecryptionError';
  }
}

/**
 * AES-256-GCM encryption for OAuth tokens at rest.
 *
 * Format: `v1:<iv b64>:<tag b64>:<data b64>` with a random 12-byte IV per message.
 * The version prefix selects the key, so a future key rotation can decrypt `v1` while
 * writing `v2`. GCM authenticates the payload: any tampering, or a wrong key, throws
 * {@link TokenDecryptionError}.
 */
export class TokenCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;

  /** @param keys base64 keys by version, e.g. `{ v1: ENCRYPTION_KEY }`. */
  constructor(keys: Record<string, string>) {
    const entries = Object.entries(keys).map(([version, b64]) => {
      const key = Buffer.from(b64, 'base64');
      if (key.length !== KEY_BYTES) {
        throw new Error(`Encryption key ${version} must be ${KEY_BYTES} bytes`);
      }
      return [version, key] as const;
    });
    this.keys = new Map(entries);
    if (!this.keys.has(CURRENT_VERSION)) {
      throw new Error(`Missing encryption key ${CURRENT_VERSION}`);
    }
  }

  encrypt(plaintext: string): string {
    const key = this.keys.get(CURRENT_VERSION) as Buffer;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [CURRENT_VERSION, iv, tag, data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
      .join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4) throw new TokenDecryptionError('malformed payload');
    const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const key = this.keys.get(version);
    if (!key) throw new TokenDecryptionError(`unknown key version "${version}"`);

    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new TokenDecryptionError('malformed payload');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      throw new TokenDecryptionError('authentication failed (tampered data or wrong key)');
    }
  }
}

/** Nest provider: the cipher bound to `ENCRYPTION_KEY`. Inject `TokenCipherService`. */
@Injectable()
export class TokenCipherService extends TokenCipher {
  constructor(config: AppConfig) {
    super({ [CURRENT_VERSION]: config.env.ENCRYPTION_KEY });
  }
}
