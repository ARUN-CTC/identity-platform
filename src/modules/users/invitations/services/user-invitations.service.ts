import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecurityUser } from '@prisma/client';
import { AppException, ResourceNotFoundException, hashPassword } from '../../../../common';
import { MailerService } from '../../../mailer/services';
import { TokenService } from '../../../jwt/services';
import { InvitationTokensRepository } from '../../../jwt/repositories';
import { SecurityEventsService } from '../../../security-audit/services';
import { UsersRepository } from '../../repositories/users.repository';
import { ValidateInvitationResult } from '../dto/validate-invitation.dto';

/** A resend attempted within this window of the last (re)send is rejected — cheap abuse guard, no new infra. */
const RESEND_COOLDOWN_MS = 60 * 1000;

const invalidInvitation = () =>
  new AppException(
    'IAM_INVITATION_TOKEN_INVALID',
    'This invitation link is invalid or has expired',
    HttpStatus.BAD_REQUEST,
  );

/**
 * Phase 1 extracted source — copied from TravelOS, classified REUSABLE with
 * one refactor: TravelOS's PlatformEmailService (a specific outbound
 * provider integration, TravelOS-only) is replaced with this platform's own
 * MailerService (console-log dev implementation — see docs/TRAVELOS_COUPLING.md).
 */
@Injectable()
export class UserInvitationsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly invitationTokens: InvitationTokensRepository,
    private readonly tokenService: TokenService,
    private readonly mailer: MailerService,
    private readonly securityEvents: SecurityEventsService,
    private readonly config: ConfigService,
  ) {}

  /** Called by UsersService.create() right after an invited (no-password) user is created — never for a password-supplied create. */
  async sendInvitation(tenantId: string, actorUserId: string | undefined, user: SecurityUser): Promise<void> {
    await this.issueAndSend(tenantId, actorUserId, user, 'iam.user_invited');
  }

  async resendInvitation(tenantId: string, actorUserId: string | undefined, userId: string): Promise<void> {
    const user = await this.usersRepository.findByIdInTenant(tenantId, userId);
    if (!user) {
      throw new ResourceNotFoundException('User', userId);
    }
    if (user.status !== 'PROVISIONED' || user.passwordHash) {
      throw new AppException(
        'IAM_USER_ALREADY_ACTIVE',
        'This user has already completed account setup — nothing to resend',
        HttpStatus.CONFLICT,
      );
    }

    const latest = await this.invitationTokens.findLatestForUser(tenantId, userId);
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new AppException(
        'IAM_INVITATION_RESEND_TOO_SOON',
        'An invitation was just sent — please wait a minute before resending',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.issueAndSend(tenantId, actorUserId, user, 'iam.invitation_resent');
  }

  /** Public — no authenticated context. Used by the accept-invitation page to show who's setting up an account and to fail fast on a dead link before rendering a password form. */
  async validateInvitation(token: string): Promise<ValidateInvitationResult> {
    const parsed = this.tokenService.parseInvitationToken(token);
    if (!parsed) {
      throw invalidInvitation();
    }
    const hash = this.tokenService.hashInvitationToken(parsed.secret);
    const existing = await this.invitationTokens.findByHash(parsed.tenantId, hash);
    if (!existing || existing.usedAt || existing.expiresAt < new Date()) {
      throw invalidInvitation();
    }
    const user = await this.usersRepository.findByIdInTenant(parsed.tenantId, existing.userId);
    if (!user || user.status !== 'PROVISIONED') {
      throw invalidInvitation();
    }
    return { valid: true, email: user.email, firstName: user.firstName, lastName: user.lastName };
  }

  /**
   * Public — no authenticated context. Concurrency-safe: invitationTokens.claim()
   * is an atomic conditional UPDATE, so under two simultaneous accept calls
   * for the same token exactly one claims it. Once claimed,
   * activateWithPassword() is itself conditioned on status: 'PROVISIONED'.
   */
  async acceptInvitation(token: string, password: string): Promise<void> {
    const parsed = this.tokenService.parseInvitationToken(token);
    if (!parsed) {
      throw invalidInvitation();
    }
    const hash = this.tokenService.hashInvitationToken(parsed.secret);
    const existing = await this.invitationTokens.findByHash(parsed.tenantId, hash);
    if (!existing || existing.usedAt || existing.expiresAt < new Date()) {
      throw invalidInvitation();
    }

    const claimed = await this.invitationTokens.claim(parsed.tenantId, existing.id);
    if (!claimed) {
      throw invalidInvitation();
    }

    const passwordHash = await hashPassword(password);
    const activated = await this.usersRepository.activateWithPassword(
      parsed.tenantId,
      existing.userId,
      passwordHash,
    );
    if (!activated) {
      throw invalidInvitation();
    }

    await this.securityEvents.record({
      tenantId: parsed.tenantId,
      actorUserId: existing.userId,
      eventType: 'iam.invitation_accepted',
      resourceType: 'SecurityUser',
      resourceId: existing.userId,
    });
  }

  private async issueAndSend(
    tenantId: string,
    actorUserId: string | undefined,
    user: SecurityUser,
    eventType: 'iam.user_invited' | 'iam.invitation_resent',
  ): Promise<void> {
    // Only the latest link should ever work — matches forgotPassword()'s own
    // invalidateAllForUser() call before issuing a fresh token.
    await this.invitationTokens.invalidateAllForUser(tenantId, user.id);

    const token = this.tokenService.generateInvitationToken(tenantId);
    const ttlHours = this.tokenService.invitationTokenTtlHours;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await this.invitationTokens.create({ tenantId, userId: user.id, tokenHash: token.hash, expiresAt });

    const baseUrl = this.config.get<string>('WEB_APP_BASE_URL');
    const inviteLink = `${baseUrl}/accept-invitation?token=${encodeURIComponent(token.plain)}`;
    const greetingName = user.firstName ?? 'there';

    await this.mailer.send({
      to: user.email,
      subject: 'You have been invited',
      text:
        `Hi ${greetingName}, you've been invited to join. ` +
        `Set up your account here (expires in ${ttlHours}h): ${inviteLink}\n\n` +
        `If you didn't expect this invitation, ignore this email.`,
    });

    await this.securityEvents.record({
      tenantId,
      actorUserId,
      eventType,
      resourceType: 'SecurityUser',
      resourceId: user.id,
      metadata: { email: user.email },
    });
  }
}
