import { HttpStatus, Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { AppException } from '../../../common';

/** No wildcard audience, in any spelling — docs/TOKEN_AND_SCOPE_ARCHITECTURE.md §6: "one token, one audience," never implicit-all. */
const FORBIDDEN_AUDIENCE_VALUES = new Set(['*', 'all', 'any']);

/**
 * Phase 2D.2 — reusable, fail-closed resource-audience policy for an
 * `Application`. An Application must explicitly enumerate every resource
 * API it may ever request a token for — there is no way to author "any
 * audience," by design (docs/EXTERNAL_API_TRUST_BOUNDARY.md §5, multi-
 * product isolation: a token for one product must never automatically
 * authorize another).
 */
@Injectable()
export class ApplicationAudiencePolicy {
  validateAudiencesForRegistration(audiences: string[]): void {
    for (const audience of audiences) {
      if (!audience) {
        throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'audiences must not contain an empty entry', HttpStatus.BAD_REQUEST);
      }
      if (FORBIDDEN_AUDIENCE_VALUES.has(audience.toLowerCase()) || audience.includes('*')) {
        throw new AppException('INVALID_AUDIENCE', `Wildcard/implicit-all audience values are not permitted: '${audience}'`, HttpStatus.BAD_REQUEST);
      }
    }
    if (new Set(audiences).size !== audiences.length) {
      throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'audiences must not contain duplicate entries', HttpStatus.BAD_REQUEST);
    }
  }

  /** Runtime (future `/token`): fail-closed — the requested audience must already be in the application's own allow-list, exact match. */
  isAudienceAllowed(application: Pick<Application, 'audiences'>, requestedAudience: string): boolean {
    return application.audiences.includes(requestedAudience);
  }
}
