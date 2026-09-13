import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../common';
import { ResourceNotFoundException } from '../../../common';
import { SessionsRepository } from '../repositories/sessions.repository';

@Injectable()
export class SessionsService {
  constructor(
    private readonly sessionsRepository: SessionsRepository,
    private readonly context: RequestContextService,
  ) {}

  listOwn(tenantId: string, userId: string) {
    return this.sessionsRepository.findManyForUser(tenantId, userId);
  }

  async revokeOwn(tenantId: string, sessionId: string): Promise<void> {
    const session = await this.sessionsRepository.findById(tenantId, sessionId);
    if (!session) {
      throw new ResourceNotFoundException('Session', sessionId);
    }
    if (session.userId !== this.context.userId) {
      throw new ForbiddenException('Cannot revoke another user\'s session');
    }
    await this.sessionsRepository.revoke(tenantId, sessionId, 'USER_REVOKED');
  }

  /** Used by UsersService when suspending/deactivating an account — revokes every active session outright, not just "the other ones". */
  async revokeAllForUser(tenantId: string, userId: string, reason: string): Promise<void> {
    await this.sessionsRepository.revokeAllForUser(tenantId, userId, reason);
  }

  async revokeAllOtherSessions(tenantId: string, userId: string, currentSessionId: string): Promise<void> {
    const sessions = await this.sessionsRepository.findManyForUser(tenantId, userId);
    await Promise.all(
      sessions
        .filter((s) => s.id !== currentSessionId && !s.revokedAt)
        .map((s) => this.sessionsRepository.revoke(tenantId, s.id, 'USER_REVOKED_OTHERS')),
    );
  }
}
