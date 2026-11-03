import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException } from '../common/errors/problem.exception';
import { PasswordService } from './password.service';
import { type ClientInfo, type CreatedSession, SessionService } from './session.service';
import { UsersRepository } from './users.repository';

/** Codes from `@omero/shared` ERROR_CODES. */
const SETUP_ALREADY_DONE = 'SETUP_ALREADY_DONE';
const INVALID_CREDENTIALS = 'INVALID_CREDENTIALS';

export interface PublicUser {
  id: string;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async needsSetup(): Promise<boolean> {
    return (await this.users.count()) === 0;
  }

  /** Creates the single owner and a first session. 409 once an owner exists. */
  async setup(
    username: string,
    password: string,
    client: ClientInfo,
  ): Promise<{ user: PublicUser; session: CreatedSession }> {
    // Cheap pre-check avoids hashing when setup is obviously done; the transaction
    // in createFirstUser is what actually guarantees a single owner.
    if (!(await this.needsSetup())) throw setupAlreadyDone();
    const hash = await this.passwords.hash(password);
    const user = await this.users.createFirstUser(username, hash);
    if (!user) throw setupAlreadyDone();
    const session = await this.sessions.create(user.id, client);
    return { user: { id: user.id, username: user.username }, session };
  }

  async login(username: string, password: string, client: ClientInfo): Promise<CreatedSession> {
    const user = await this.users.findByUsername(username);
    const ok = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyDummy(password);
    if (!user || !ok) {
      throw new ProblemException({
        status: HttpStatus.UNAUTHORIZED,
        code: INVALID_CREDENTIALS,
        detail: 'Invalid username or password.',
      });
    }
    // TODO: rehash with argon2.needsRehash() when ARGON2_OPTIONS are raised.
    return this.sessions.create(user.id, client);
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    // The FK cascades session deletion with the user, so this only races a deletion.
    if (!user) throw ProblemException.notFound('User not found');
    return { id: user.id, username: user.username };
  }
}

function setupAlreadyDone(): ProblemException {
  return ProblemException.conflict(SETUP_ALREADY_DONE, 'The owner account already exists.');
}
