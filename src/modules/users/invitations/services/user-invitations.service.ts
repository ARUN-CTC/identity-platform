import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecurityUser } from '@prisma/client';
import { AppException, hashPassword } from '../../../../common';
import { MailerService } from '../../../mailer/services';
import { TokenService } from '../../../jwt/services';
import { InvitationTokensRepository } from '../../../jwt/repositories';
import { MembershipsRepository } from '../../../memberships/repositories';
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
 *
 * PHASE 2A (docs/PHASE_2A.md): an invitation now onboards a global Identity
 * into one specific Organization's Membership, not "into a tenant" in the
 * abstract. Because an Identity is global, the *same not-yet-activated*
 * Identity can legitimately have more than one pending INVITED membership
 * (and therefore more than one valid invitation token) at once, across
 * different organizations/tenants — acceptInvitation() is written to stay
 * correct whichever one is accepted first.
 */
@Injectable()
export class UserInvitationsService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly invitationTokens: InvitationTokensRepository,
    private readonly memberships: MembershipsRepository,
    private readonly tokenService: TokenService,
    private readonly mailer: MailerService,
    private readonly securityEvents: SecurityEventsService,
    private readonly config: ConfigService,
  ) {}

  /** Called by UsersService.create() right after a new-to-this-organization INVITED membership is created — never for a membership that started ACTIVE. */
  async sendInvitation(tenantId: string, actorUserId: string | undefined, user: SecurityUser, organizationId: string): Promise<void> {
    await this.issueAndSend(tenantId, actorUserId, user, organizationId, 'iam.user_invited');
  }

  /**
   * Called by UsersService.create() when the invited email already resolves
   * to an existing, already-activated global Identity (they have a
   * password already, from another tenant/organization) — no invitation
   * token or accept step needed, just a heads-up email. See
   * docs/PHASE_2A.md.
   */
  async notifyAddedToOrganization(user: SecurityUser): Promise<void> {
    const baseUrl = this.config.get<string>('WEB_APP_BASE_URL');
    const greetingName = user.firstName ?? 'there';
    await this.mailer.send({
      to: user.email,
      subject: "You've been added to a new organization",
      text:
        `Hi ${greetingName}, you've been added to a new organization on your existing account. ` +
        `Sign in as usual to access it: ${baseUrl}`,
    });
  }

  async resendInvitation(tenantId: string, actorUserId: string | undefined, userId: string, organizationId: string): Promise<void> {
    const user = await this.usersRepository.findByIdGlobal(userId);
    if (!user) {
      throw invalidInvitation();
    }
    const membership = await this.memberships.findByUserAndOrg(tenantId, userId, organizationId);
    if (!membership || membership.status !== 'INVITED') {
      throw new AppException(
        'IAM_USER_ALREADY_ACTIVE',
        'This membership has already been activated (or does not exist) — nothing to resend',
        HttpStatus.CONFLICT,
      );
    }

    const latest = await this.invitationTokens.findLatestForUser(tenantId, userId, organizationId);
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new AppException(
        'IAM_INVITATION_RESEND_TOO_SOON',
        'An invitation was just sent — please wait a minute before resending',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.issueAndSend(tenantId, actorUserId, user, organizationId, 'iam.invitation_resent');
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
    const user = await this.usersRepository.findByIdGlobal(existing.userId);
    if (!user) {
      throw invalidInvitation();
    }
    return { valid: true, email: user.email, firstName: user.firstName, lastName: user.lastName };
  }

  /**
   * Public — no authenticated context. Concurrency-safe: invitationTokens.claim()
   * is an atomic conditional UPDATE, so under two simultaneous accept calls
   * for the same token exactly one claims it.
   *
   * PHASE 2A: only sets a password / activates the global Identity when it
   * doesn't already have one — a second pending invitation for an Identity
   * that already activated itself via a *different* organization's
   * invitation link in the meantime just activates this organization's
   * membership, without touching the (already-set) password. See this
   * class's own doc comment.
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

    const user = await this.usersRepository.findByIdGlobal(existing.userId);
    if (!user) {
      throw invalidInvitation();
    }

    if (!user.passwordHash) {
      const passwordHash = await hashPassword(password);
      const activated = await this.usersRepository.activateWithPassword(existing.userId, passwordHash);
      if (!activated) {
        throw invalidInvitation();
      }
    }

    await this.memberships.setStatus(parsed.tenantId, existing.userId, existing.organizationId, 'ACTIVE', existing.userId);

    await this.securityEvents.record({
      tenantId: parsed.tenantId,
      actorUserId: existing.userId,
      eventType: 'iam.invitation_accepted',
      resourceType: 'SecurityUser',
      resourceId: existing.userId,
      metadata: { organizationId: existing.organizationId },
    });
  }

  private async issueAndSend(
    tenantId: string,
    actorUserId: string | undefined,
    user: SecurityUser,
    organizationId: string,
    eventType: 'iam.user_invited' | 'iam.invitation_resent',
  ): Promise<void> {
    // Only the latest link (for this organization) should ever work —
    // matches forgotPassword()'s own invalidateAllForUser() call before
    // issuing a fresh token.
    await this.invitationTokens.invalidateAllForUser(tenantId, user.id, organizationId);

    const token = this.tokenService.generateInvitationToken(tenantId);
    const ttlHours = this.tokenService.invitationTokenTtlHours;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    await this.invitationTokens.create({ tenantId, userId: user.id, organizationId, tokenHash: token.hash, expiresAt });

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
      metadata: { email: user.email, organizationId },
    });
  }
}
