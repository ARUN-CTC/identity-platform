import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuthenticatedExternalPrincipal } from '../interfaces';
import { ExternalPrincipalClsStore } from './external-principal-cls-store';

/**
 * Phase 2D.5 — request-scoped (AsyncLocalStorage-backed, concurrency-safe)
 * accessor for the current request's validated external principal, mirroring
 * `RequestContextService`'s own shape (`src/common/context/request-context.service.ts`)
 * for the external/ServiceAccount trust boundary specifically. Never a
 * mutable singleton/module-level field — every value flows through
 * `ClsService`, which nestjs-cls's `ClsMiddleware` opens fresh per request
 * (already applied globally in `main.ts`), the same mechanism that already
 * gives `RequestContextService` its own proven per-request isolation.
 */
@Injectable()
export class ExternalPrincipalContextService {
  constructor(private readonly cls: ClsService<ExternalPrincipalClsStore>) {}

  get principal(): AuthenticatedExternalPrincipal | undefined {
    return this.cls.get('externalPrincipal');
  }

  setPrincipal(principal: AuthenticatedExternalPrincipal): void {
    this.cls.set('externalPrincipal', principal);
  }
}
