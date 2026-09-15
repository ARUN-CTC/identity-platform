# SDK Strategy

Not built in Phase 2. This defines the future approach so no product is forced onto the Identity Platform's own language/stack.

## 1. Foundation: OpenAPI first

The REST API (`docs/API_BOUNDARY.md`) is documented as an OpenAPI 3 spec (NestJS's `@nestjs/swagger` already generates most of this from Phase 1's DTOs — extending it to full accuracy is a Phase 2 implementation task, not a new capability). The spec is the single source of truth every SDK is generated from — hand-written SDKs are avoided (they drift from the actual API) except for one hand-crafted validation/middleware layer per language (§3), which cannot be generated because it involves local cryptographic logic, not just HTTP calls.

## 2. What a "client" actually needs, split in two

Every product needs two genuinely different things, and conflating them into one "SDK" produces a worse result than shipping them separately:

1. **A generated API client** — thin, mechanical, request/response types matching the OpenAPI spec. Regenerated automatically whenever the spec changes. No hand-maintained logic.
2. **A JWT validation / middleware library** — the part every product actually calls on every single request: verify signature against the cached JWKS, check `aud`/`exp`/`iss`, extract `tenant_id`/`organization_id`/`roles` claims, and (for frameworks that support it) a drop-in middleware/guard that does this automatically per-request, mirroring Phase 1's own `JwtAuthGuard` pattern but as a reusable, product-facing package rather than internal code.

The second is more valuable than the first and should be prioritized — a product can call the REST API directly with any HTTP client on day one; it cannot safely reimplement JWT/JWKS validation correctly from scratch without real risk (wrong algorithm accepted, missing `aud` check, no key-rotation handling — exactly the class of bug this architecture spends effort preventing in `docs/SECURITY_ARCHITECTURE.md`).

## 3. Candidate languages, in priority order

| Language | Priority | Why |
|---|---|---|
| TypeScript | First | Covers browser SDKs directly (login flow is browser-to-Identity-Platform per `AUTHENTICATION_ARCHITECTURE.md`) and any Node-based product backend; highest immediate leverage. |
| Python | Second | Common product-backend choice (e.g. a Healthcare product built on Django/FastAPI). |
| Java / Kotlin | Third | Common enterprise backend choice; JVM's JWT ecosystem is mature, mostly wraps existing libraries (`jjwt`, Nimbus). |
| .NET | Third | Same rationale as Java, for the .NET ecosystem. |
| Go | Fourth | Lightweight middleware is easy to hand-write in Go even without a generated client; lower priority for a full SDK. |

## 4. What is explicitly not done in Phase 2

No SDK is published. No package registry account is created. No versioning/release process for SDKs is set up. This is deferred to `docs/PHASE_2_IMPLEMENTATION_PLAN.md` Phase 2I, gated on the API contract (`API_BOUNDARY.md`) being stable enough that generated clients aren't churning weekly.
