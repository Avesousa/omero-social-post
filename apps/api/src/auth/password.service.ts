import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * argon2id with the OWASP baseline (19 MiB, t=2, p=1): strong enough for a single owner
 * and light on a 1 vCPU / 4 GB box. Parameters are encoded in each hash, so they can be
 * raised later without invalidating existing passwords.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  /** Hash verified when the username is unknown, so response time does not reveal it. */
  private dummyHash?: Promise<string>;

  onModuleInit(): void {
    this.dummyHash = argon2.hash('omero-dummy-password-for-timing', ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed hash: treat as a mismatch rather than a 500.
      return false;
    }
  }

  /** Burns the same time as a real verification and always fails. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= argon2.hash('omero-dummy-password-for-timing', ARGON2_OPTIONS);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
