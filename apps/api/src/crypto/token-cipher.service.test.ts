import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenCipher, TokenDecryptionError } from './token-cipher.service';

const keyA = randomBytes(32).toString('base64');
const keyB = randomBytes(32).toString('base64');

describe('TokenCipher', () => {
  const cipher = new TokenCipher({ v1: keyA });

  it('round-trips ASCII and unicode plaintexts', () => {
    for (const plain of ['access-token-123', '', 'ñandú 🚀 トークン', 'x'.repeat(4096)]) {
      expect(cipher.decrypt(cipher.encrypt(plain))).toBe(plain);
    }
  });

  it('writes the v1:<iv>:<tag>:<data> format with a 12-byte IV and 16-byte tag', () => {
    const [version, iv, tag, data] = cipher.encrypt('secret').split(':');
    expect(version).toBe('v1');
    expect(Buffer.from(iv!, 'base64')).toHaveLength(12);
    expect(Buffer.from(tag!, 'base64')).toHaveLength(16);
    expect(Buffer.from(data!, 'base64')).toHaveLength('secret'.length);
  });

  it('uses a fresh random IV for every encryption', () => {
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });

  it.each([
    ['data', 3],
    ['tag', 2],
    ['iv', 1],
  ])('detects tampering with the %s segment', (_name, index) => {
    const parts = cipher.encrypt('do not touch').split(':');
    const bytes = Buffer.from(parts[index]!, 'base64');
    bytes[0] = bytes[0]! ^ 0x01;
    parts[index] = bytes.toString('base64');
    expect(() => cipher.decrypt(parts.join(':'))).toThrow(TokenDecryptionError);
  });

  it('fails with a different key', () => {
    const other = new TokenCipher({ v1: keyB });
    expect(() => other.decrypt(cipher.encrypt('mine'))).toThrow(TokenDecryptionError);
  });

  it('rejects malformed payloads and unknown versions', () => {
    expect(() => cipher.decrypt('garbage')).toThrow(TokenDecryptionError);
    expect(() => cipher.decrypt('v1:a:b')).toThrow(TokenDecryptionError);
    const [, iv, tag, data] = cipher.encrypt('x').split(':');
    expect(() => cipher.decrypt(['v9', iv, tag, data].join(':'))).toThrow(/unknown key version/);
  });

  it('never leaks the plaintext or key in error messages', () => {
    const payload = new TokenCipher({ v1: keyB }).encrypt('super-secret-token');
    try {
      cipher.decrypt(payload);
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('super-secret-token');
      expect(String(err)).not.toContain(keyA);
    }
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => new TokenCipher({ v1: randomBytes(16).toString('base64') })).toThrow(/32 bytes/);
  });
});
