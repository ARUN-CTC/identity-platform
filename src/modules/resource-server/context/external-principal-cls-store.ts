import { ClsStore } from 'nestjs-cls';
import { AuthenticatedExternalPrincipal } from '../interfaces';

/**
 * Phase 2D.5 — a store view distinct from `AppClsStore`
 * (`src/common/context/app-cls-store.ts`), deliberately NOT merged into it:
 * `AppClsStore` is the human/tenant-session model (`tenantId`/`userId`/
 * `organizationId`, populated by `JwtAuthGuard`); this is the external
 * Resource Server principal (`ServiceAccount`-shaped, populated by
 * `ExternalBearerAuthGuard`). The two guards never run on the same route
 * (`docs/EXTERNAL_API_TRUST_BOUNDARY.md` §0's structural separation
 * extended one layer further), so keeping their CLS shapes separate too
 * prevents a downstream service from ever reading, say, `tenantId` and
 * getting the wrong trust boundary's value by accident.
 *
 * `nestjs-cls`'s `ClsService<T>` is a compile-time-typed VIEW over one
 * shared, per-request `AsyncLocalStorage` store — injecting
 * `ClsService<ExternalPrincipalClsStore>` here and
 * `ClsService<AppClsStore>` elsewhere both read/write the same underlying
 * request-scoped object, just validated against different key sets. No
 * new CLS middleware/module registration is needed.
 */
export interface ExternalPrincipalClsStore extends ClsStore {
  externalPrincipal?: AuthenticatedExternalPrincipal;
}
