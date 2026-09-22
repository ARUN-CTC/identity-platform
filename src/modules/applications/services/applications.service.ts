import { HttpStatus, Injectable } from '@nestjs/common';
import { Application, Prisma } from '@prisma/client';
import {
  AppException,
  PaginatedResult,
  PaginationQueryDto,
  RequestContextService,
  ResourceConflictException,
  ResourceNotFoundException,
  generateClientId,
  generateClientSecret,
  hashClientSecret,
} from '../../../common';
import { ProductsService } from '../../products/services';
import { SecurityEventsService } from '../../security-audit/services';
import { CreateApplicationDto } from '../dto/create-application.dto';
import { UpdateApplicationDto } from '../dto/update-application.dto';
import { ApplicationAudiencePolicy, ApplicationGrantPolicy, ApplicationScopePolicy, OriginPolicy, RedirectUriPolicy, TokenEndpointAuthMethodPolicy } from '../policies';
import { ApplicationsRepository } from '../repositories/applications.repository';

/** create()'s response — the one and only time clientSecret is ever shown in plaintext (docs/PHASE_2B.md §13). */
export interface CreatedApplication extends Omit<Application, 'clientSecretHash'> {
  clientSecret: string | null;
}

/**
 * Phase 2B — Application (== "client") registration under a Product
 * (docs/PHASE_2B.md, docs/PHASE_2B_DOMAIN_MODEL.md). Platform-level, no
 * tenant scoping. clientSecretHash is stripped from every response except
 * the one-time plaintext shown at creation (CreatedApplication).
 *
 * PHASE 2D.2 (docs/APPLICATION_AUTHORIZATION.md, docs/adr/ADR-018) — this
 * service is now also the ONE place an Application's OAuth client
 * configuration (grantTypes/allowedScopes/audiences/redirectUris/
 * allowedOrigins/tokenEndpointAuthMethod) is validated before being
 * persisted — every rule delegates to its own dedicated policy class
 * (src/modules/applications/policies), never reimplemented inline, so a
 * future /authorize|/token implementation reusing those same policies can
 * never see a rule enforced differently here than there.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly repository: ApplicationsRepository,
    private readonly productsService: ProductsService,
    private readonly context: RequestContextService,
    private readonly securityEvents: SecurityEventsService,
    private readonly grantPolicy: ApplicationGrantPolicy,
    private readonly scopePolicy: ApplicationScopePolicy,
    private readonly audiencePolicy: ApplicationAudiencePolicy,
    private readonly redirectUriPolicy: RedirectUriPolicy,
    private readonly originPolicy: OriginPolicy,
    private readonly authMethodPolicy: TokenEndpointAuthMethodPolicy,
  ) {}

  async listForProduct(productId: string, query: PaginationQueryDto): Promise<PaginatedResult<Application>> {
    await this.productsService.findOne(productId); // 404s a nonexistent product before an empty-but-misleading list
    const [items, total] = await this.repository.findManyForProduct(productId, query.skip, query.take);
    return new PaginatedResult(items.map((a) => this.sanitize(a)), total, query);
  }

  async findOne(id: string): Promise<Application> {
    const application = await this.repository.findById(id);
    if (!application) {
      throw new ResourceNotFoundException('Application', id);
    }
    return this.sanitize(application);
  }

  /**
   * The one endpoint that ever sees a plaintext client_secret — generated
   * here, hashed for storage, returned once. A PUBLIC client gets no secret
   * at all: clientSecretHash stays null, clientSecret in the response is
   * null — PKCE (not implemented yet) is its only proof of possession.
   */
  async create(productId: string, dto: CreateApplicationDto): Promise<CreatedApplication> {
    const product = await this.productsService.findOne(productId); // 404s a nonexistent product, same as every other org-scoped-style existence check in this codebase

    const clientType = dto.clientType ?? 'CONFIDENTIAL';
    const grantTypes = dto.grantTypes ?? [];
    const allowedScopes = dto.allowedScopes ?? [];
    const audiences = dto.audiences ?? [];
    const redirectUris = dto.redirectUris ?? [];
    const allowedOrigins = dto.allowedOrigins ?? [];

    this.validateConfiguration(product.slug, clientType, grantTypes, allowedScopes, audiences, redirectUris, allowedOrigins);

    // Derived strictly from clientType — never accepted as input (ADR-018).
    const tokenEndpointAuthMethod = this.authMethodPolicy.derive(clientType);

    const clientId = generateClientId();
    const plainSecret = clientType === 'CONFIDENTIAL' ? generateClientSecret() : null;

    let application: Application;
    try {
      application = await this.repository.create({
        productId,
        name: dto.name,
        clientId,
        clientSecretHash: plainSecret ? hashClientSecret(plainSecret) : null,
        clientType,
        secretCreatedAt: plainSecret ? new Date() : null,
        redirectUris,
        allowedOrigins,
        grantTypes,
        allowedScopes,
        audiences,
        tokenEndpointAuthMethod,
      });
    } catch (err) {
      // clientId collision is astronomically unlikely (144 bits of entropy,
      // src/common/utils/client-credential.util.ts) but the uk_application_client_id
      // constraint is the actual authority, not this application's own
      // randomness — handled deterministically rather than surfacing as an
      // unhandled 500 (same local-catch pattern Phase 2B.2 already
      // established for the same reason: the global P2002->409 filter is
      // not wired anywhere in this codebase).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ResourceConflictException('Application', 'A client_id collision occurred — please retry');
      }
      throw err;
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'APPLICATION_CREATED',
      resourceType: 'Application',
      resourceId: application.id,
      metadata: { productId, name: application.name, clientId: application.clientId, clientType, grantTypes, tokenEndpointAuthMethod },
    });
    if (plainSecret) {
      await this.securityEvents.recordPlatformEvent({
        actorUserId: this.context.userId,
        eventType: 'CLIENT_CREDENTIAL_CREATED',
        resourceType: 'Application',
        resourceId: application.id,
        metadata: { clientId: application.clientId },
      });
    }

    const { clientSecretHash: _clientSecretHash, ...rest } = application;
    return { ...rest, clientSecret: plainSecret };
  }

  async update(id: string, dto: UpdateApplicationDto): Promise<Application> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new ResourceNotFoundException('Application', id);
    }

    // Re-validate exactly what's actually changing, against the
    // EXISTING (immutable) clientType — never re-derive/accept a new
    // tokenEndpointAuthMethod here; it stays whatever create() derived.
    const grantTypes = dto.grantTypes ?? existing.grantTypes;
    const allowedScopes = dto.allowedScopes ?? existing.allowedScopes;
    const audiences = dto.audiences ?? existing.audiences;
    const redirectUris = dto.redirectUris ?? existing.redirectUris;
    const allowedOrigins = dto.allowedOrigins ?? existing.allowedOrigins;

    if (dto.grantTypes || dto.allowedScopes || dto.audiences || dto.redirectUris || dto.allowedOrigins) {
      const product = await this.productsService.findOne(existing.productId);
      this.validateConfiguration(product.slug, existing.clientType, grantTypes, allowedScopes, audiences, redirectUris, allowedOrigins);
    }

    const updated = await this.repository.update(id, dto);
    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: dto.status === 'DISABLED' ? 'APPLICATION_DISABLED' : dto.status === 'ACTIVE' && existing.status !== 'ACTIVE' ? 'APPLICATION_ENABLED' : 'APPLICATION_UPDATED',
      resourceType: 'Application',
      resourceId: id,
      metadata: { before: { name: existing.name, status: existing.status }, after: { name: updated.name, status: updated.status } },
    });
    return this.sanitize(updated);
  }

  /**
   * Phase 2UI.2 (docs/CREDENTIAL_ROTATION.md) — the P0 gap Phase 2UI.1
   * found: a leaked production client_secret previously had no remedy
   * except recreating the entire Application. This is ATOMIC REPLACEMENT,
   * not overlapping/graceful rotation: the old secret stops verifying the
   * instant this commits, matching this platform's existing one-time-
   * reveal philosophy (OneTimeSecretDialog) rather than adding a new
   * multi-credential entity for a capability nothing in this codebase's
   * existing Application schema was built to support (a single
   * `clientSecretHash` column, not a one-to-many credential table) — see
   * that doc's own "Rotation semantics" section for the full reasoning and
   * the documented operational consequence.
   */
  async rotateSecret(id: string): Promise<CreatedApplication> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new ResourceNotFoundException('Application', id);
    }
    if (existing.clientType !== 'CONFIDENTIAL') {
      throw new AppException('APPLICATION_NOT_ROTATABLE', 'Only a CONFIDENTIAL application has a client secret to rotate — a PUBLIC application has none', HttpStatus.BAD_REQUEST);
    }
    if (existing.status !== 'ACTIVE') {
      throw new AppException('APPLICATION_NOT_ROTATABLE', `Cannot rotate a client secret while the application's status is ${existing.status} (must be ACTIVE)`, HttpStatus.CONFLICT);
    }

    const plainSecret = generateClientSecret();
    const applied = await this.repository.rotateSecret(id, existing.version, hashClientSecret(plainSecret));
    if (!applied) {
      throw new AppException('CONCURRENT_MODIFICATION', 'This application was modified concurrently — please retry', HttpStatus.CONFLICT);
    }

    await this.securityEvents.recordPlatformEvent({
      actorUserId: this.context.userId,
      eventType: 'CLIENT_CREDENTIAL_ROTATED',
      resourceType: 'Application',
      resourceId: id,
      // Never the secret itself, never its hash — only the fact that a
      // rotation happened and which client_id it applies to (clientId is
      // a public, non-secret identifier, safe to log — see
      // client-credential.util.ts's own header comment).
      metadata: { clientId: existing.clientId },
    });

    const refreshed = await this.repository.findById(id);
    const { clientSecretHash: _clientSecretHash, ...rest } = refreshed!;
    return { ...rest, clientSecret: plainSecret };
  }

  /**
   * Every registration-time rule, composed — delegates entirely to the
   * dedicated policy classes (never reimplemented here) plus the two
   * cross-field rules that don't belong to any single policy:
   * (1) grantTypes vs. clientType (ApplicationGrantPolicy already owns the
   *     PUBLIC+client_credentials case; nothing else needed here), and
   * (2) authorization_code requires at least one registered redirect URI —
   *     a client that can never redirect anywhere cannot complete that
   *     grant, so registering it without one is a contradictory
   *     configuration (brief §32).
   */
  private validateConfiguration(
    productSlug: string,
    clientType: string,
    grantTypes: string[],
    allowedScopes: string[],
    audiences: string[],
    redirectUris: string[],
    allowedOrigins: string[],
  ): void {
    this.grantPolicy.validateGrantTypesForRegistration(clientType, grantTypes);
    this.scopePolicy.validateScopesForRegistration(productSlug, allowedScopes);
    this.audiencePolicy.validateAudiencesForRegistration(audiences);
    this.redirectUriPolicy.validateRedirectUrisForRegistration(redirectUris);
    this.originPolicy.validateOriginsForRegistration(allowedOrigins);

    if (grantTypes.includes('authorization_code') && redirectUris.length === 0) {
      throw new AppException(
        'INVALID_APPLICATION_CONFIGURATION',
        'A client configured for the authorization_code grant must register at least one redirect URI',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private sanitize(application: Application): Application {
    const { clientSecretHash: _clientSecretHash, ...rest } = application;
    return rest as Application;
  }
}
