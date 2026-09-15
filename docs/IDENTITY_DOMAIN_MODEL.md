# Identity Domain Model

This document defines who owns what. It is the foundation every other Phase 2 document builds on. Read `docs/PHASE_2_BASELINE.md` first for the current-state facts referenced here.

## 1. Ownership table

| Entity | Owner | Purpose | Product-specific? |
|---|---|---|---|
| Identity (person/system) | Identity Platform | Who is this, globally, across the whole platform | No |
| Credential | Identity Platform | Password hash, future MFA factors, passkeys | No |
| Session | Identity Platform | A live authenticated context (device, active org, lifecycle) | No |
| Token (access/refresh) | Identity Platform | Proof of authentication, carried to products | No |
| Tenant | Identity Platform | Commercial/contractual/isolation boundary (the customer account) | No |
| Organization | Identity Platform | Operational subdivision within a Tenant | No |
| Organization Unit | Identity Platform | Hierarchy within an Organization (branch/dept/team) | No |
| Membership | Identity Platform | The fact that an Identity participates in an Organization | No |
| Role | Identity Platform (mechanism) / Product (content, for product-scoped roles) | Named bundle of permissions | Mixed — see §5 |
| Permission (core) | Identity Platform | `identity.*` — manage users, orgs, roles, sessions | No |
| Permission (product) | Product (content) / Identity Platform (catalog + storage) | `travel.*`, `healthcare.*`, `gym.*` | Yes |
| Policy | Identity Platform (mechanism, future) | Attribute/condition-based rule evaluated alongside RBAC | No |
| Invitation | Identity Platform | Admin-initiated onboarding of a new Identity into an Organization | No |
| Product | Identity Platform (catalog) | Abstract SaaS offering: TravelOS, Healthcare, Gym | N/A — this *is* the product boundary |
| Application (OAuth client) | Identity Platform | A concrete registered consumer of the Identity API (web app, mobile app, backend service) | No (it's a credential holder, not business logic) |
| Tenant Product Subscription | Identity Platform | Which Tenant is entitled to use which Product | No |
| Service Account | Identity Platform | Non-human identity for service-to-service calls | No |
| Audit Event / Security Event | Identity Platform | Identity/auth/authz event log | No |
| Booking, Ticket, Supplier, Itinerary | TravelOS | Travel business | Yes |
| Patient, Doctor, Appointment, Medical Record | Healthcare | Healthcare business | Yes |
| Member (business profile), Trainer, Workout, Gym-Subscription | Gym | Gym business | Yes |

Note the naming collision: "Member/Subscription" appears both as a Gym business concept and as Identity Platform infrastructure (Membership, Tenant Product Subscription). These are deliberately distinct entities in different domains that happen to share vocabulary — a Gym "Member" is a product-domain profile referencing an Identity Platform user id by reference only; it is not the same row as a `Membership`.

## 2. Challenging Phase 1's terminology and model

Per the Phase 2 brief's instruction not to assume the existing model is correct, three things were re-examined:

### 2.1 `SecurityUser` should become a global `Identity`, not a per-tenant row

**Finding:** Phase 1's `SecurityUser` is scoped to exactly one `Tenant` (`tenantId` required, `(tenantId, email)` unique). This mirrors TravelOS, where it was a correct decision — TravelOS is one product and never needed a user to exist independently of a tenant.

**Why this breaks under Phase 2's actual requirement:** Step 3 of the brief asks directly: *"Can one user belong to multiple organizations? Can one user belong to multiple products? Can one organization subscribe to multiple products?"* A real multi-product platform needs a stronger case still: the same physical person (say, a consultant, or a company owner) may need to sign in to TravelOS under Tenant A and to Gym under Tenant B, with one email and one password, not two unrelated accounts that happen to share an inbox. Today's schema cannot represent that — a `SecurityUser` row cannot exist without picking exactly one tenant.

**Decision:** Introduce **global identity**. The entity conceptually named `User` becomes tenant-independent: one row per person/system across the entire platform. What is tenant/organization-scoped is not the identity — it is the **Membership** (a new/renamed entity, replacing the implicit tenant-ownership currently baked into `SecurityUser`) that connects an Identity to exactly one Organization (and transitively, one Tenant), carrying its own status (invited/active/suspended) independent of the identity's own global status.

This is the single largest schema-shape change Phase 2 identifies. It is **not implemented in this phase** (see `docs/PHASE_2_IMPLEMENTATION_PLAN.md`, Phase 2A) — Phase 2 is architecture-first, and this decision is recorded so 2A can execute it deliberately rather than it being discovered mid-implementation. See ADR-002.

Practical consequence for uniqueness: login identifier (email) uniqueness moves from `(tenantId, email)` to global, OR the platform supports one email resolving to multiple Identities only in the rare case of genuinely separate people sharing a shared inbox (not designed for in Phase 2 — treated as an edge case, not a feature). Standard practice (this is how Slack, GitHub, WorkOS, Auth0 Organizations, Okta, and Clerk all model it): one global identity, N organization memberships, each membership independently invitable/removable/suspendable.

### 2.2 Tenant ≠ Organization — both are kept, with tightened definitions

**Finding:** Phase 1 already has both `Tenant` and `Organization` as separate entities. The Phase 2 brief asks (Step 3, Q1) whether they should be equivalent. They should not be collapsed.

**Decision:**
- **Tenant** = the commercial/contractual/data-isolation boundary. This is "the customer" — the entity that has a subscription, a billing relationship, and a Row-Level-Security partition. One Tenant can use one or many Products.
- **Organization** = an operational subdivision inside a Tenant — a division, subsidiary, brand, or franchise. A small customer has exactly one Organization (auto-created at signup, invisible to the end user as a separate concept). A large enterprise customer can have many. Organizations are where **Membership** and role grants actually attach — not the Tenant directly, though a tenant-wide grant is still representable (see §4, existing `organizationId` nullable pattern, retained).
- **Organization Unit** = a further hierarchy *within* one Organization (branch/department/team) — unchanged from Phase 1, still schema-present, still deferred for its own service/controller.

### 2.3 Role should not (yet) gain a hard "product" foreign key

**Finding:** It would be tempting to add `productId`/`applicationId` directly onto `Role`, forcing every role to declare which product it belongs to.

**Decision:** Reject this. A `Role` stays a plain named bundle of `Permission`s, full stop. It becomes implicitly "product-relevant" only through *which* permissions it bundles (a role that bundles only `travel.*` permissions is de facto a TravelOS role; a role can also legally mix `identity.*` and `travel.*` permissions — e.g. "Tenant Admin" bundling `identity.organization.manage` + every product's `*.manage` permission). This keeps `Role` product-agnostic mechanism, matching the brief's "IMPORTANT ARCHITECTURAL PRINCIPLE" section, while `Permission.code` namespacing (§5) is what actually carries product identity. See `docs/AUTHORIZATION_ARCHITECTURE.md`.

## 3. Full entity list with ownership and rationale

| Entity | Owner | Purpose | Product-specific? |
|---|---|---|---|
| User / Identity | Identity Platform | Global authenticatable principal | No |
| Credential | Identity Platform | Password/MFA factor/passkey attached to an Identity | No |
| Session | Identity Platform | Active login context, one active Organization at a time | No |
| Token | Identity Platform | Access/refresh/(future) ID token, issued for a Session | No |
| Tenant | Identity Platform | Billing/isolation boundary | No |
| Organization | Identity Platform | Subdivision within a Tenant | No |
| OrganizationUnit | Identity Platform | Hierarchy within an Organization | No |
| Membership | Identity Platform | Identity ↔ Organization link (replaces implicit tenant-ownership on User) | No |
| Role | Identity Platform | Named permission bundle | No (content may reference product permissions) |
| Permission | Identity Platform (catalog/storage) + Product (content, if namespaced to a product) | Discrete grantable action | Core: No. Namespaced: Yes |
| Policy | Identity Platform | Future conditional/attribute rule layered on RBAC | No |
| Invitation | Identity Platform | Onboards an Identity into an Organization/Membership | No |
| ServiceAccount | Identity Platform | Machine identity for service-to-service auth | No |
| Application | Identity Platform | Registered OAuth/OIDC client of the Identity API | No |
| Product | Identity Platform | Catalog entry: TravelOS / Healthcare / Gym / future | N/A |
| TenantProductSubscription | Identity Platform | Entitlement: which Tenant may use which Product | No |
| AuditEvent / SecurityEvent | Identity Platform | Identity/auth/authz event log | No |
| (Product business entities — Booking, Patient, Workout, etc.) | Each respective Product | Product's own business domain | Yes |

## 4. Answers to the Step 3 tenant-model questions

1. **Is Tenant equivalent to Organization?** No — see §2.2.
2. **Can one tenant contain multiple organizations?** Yes (already true in Phase 1's schema; unchanged).
3. **Can one organization contain multiple organization units?** Yes (already true; unchanged; service/controller still deferred).
4. **Can one user belong to multiple organizations?** Yes, within a tenant today (multiple `SecurityUserRole` rows). Across tenants: **not today** — requires the global-identity change in §2.1. Target: yes, via multiple Memberships, each in its own Tenant/Organization.
5. **Can one user belong to multiple products?** Yes, transitively — a user's Organization(s) determine which Product(s) they can reach, via that Organization's Tenant's `TenantProductSubscription`s. No per-product user record is needed.
6. **Can one organization subscribe to multiple products?** Subscription lives at the **Tenant** level (billing is normally contracted per company, not per division) with Organization-level override as a documented future extension point, not built now. See `docs/PRODUCT_REGISTRATION.md` §3.
7. **Can roles differ by organization?** Yes — `SecurityUserRole.organizationId` already scopes a grant to one Organization (nullable = tenant-wide). Unchanged.
8. **Can roles differ by product?** Yes, indirectly — via which permissions a role bundles (§2.3). No, directly — no hard product FK on Role.
9. **Can permissions be product-specific?** Yes — namespaced permission codes (`travel.booking.create`), registered by each product into the shared catalog. See `docs/AUTHORIZATION_ARCHITECTURE.md` §2.
10. **How is organization context represented?** `Session.organizationId` (nullable = no active org selected / tenant-wide) is the source of truth; the active access token's `organization_id` claim mirrors it. See `docs/ORGANIZATION_CONTEXT.md`.
11. **How is tenant context represented?** `tenant_id` claim on every token, plus the RLS GUC `app.current_tenant_id` set per request. A Membership always belongs to exactly one Tenant, so tenant context is never ambiguous even for a multi-tenant Identity.
12. **Can an administrator manage multiple organizations?** Yes — grant a role with `organizationId = NULL` for tenant-wide scope, or grant the same role across several explicit Organizations.
13. **How are cross-tenant/cross-organization administrators (platform operator staff) handled?** Not as a `Membership` at all — see §6. A platform operator is not a customer-tenant's data; forcing them into a "home tenant" would violate tenant isolation. They are modeled as a distinct `PlatformOperator`/platform-scoped grant, out of the tenant-partitioned RLS space entirely. This is a documented gap in Phase 1 (a `SecurityUserRole` row today still requires a non-null `tenantId` even for what was intended as a system-wide grant) and is called out explicitly so Phase 2A does not paper over it by inventing a fake "platform tenant."

## 5. Core vs. product permission namespacing (preview — full design in AUTHORIZATION_ARCHITECTURE.md)

Permission codes are namespaced by a prefix that is either `identity` (core, owned by the Identity Platform itself) or a product slug (`travel`, `healthcare`, `gym`, ...). The Identity Platform stores and serves both, but only *authors* the `identity.*` set. Product-namespaced permissions are authored/registered by each product (see `docs/PRODUCT_REGISTRATION.md`) and are opaque strings to the Identity Platform — it never interprets their meaning, only stores, catalogs, and includes them in role bundles and token/authorization responses.

## 6. Platform operator staff (cross-tenant administrators)

Platform operator staff (the company running the Identity Platform itself, e.g. for support/ops) are **not** Tenant data and must not be modeled as a `Membership` into a customer's Organization — that would leak operator identities into a tenant's RLS-partitioned space and make "delete this tenant" operations ambiguous about whether it deletes staff accounts. They are modeled separately (see ADR-002): a small, explicitly platform-scoped principal type with its own audit trail, kept out of `tenant_id`-partitioned tables entirely. This is a "documented, not yet built" item — no platform-operator UI or workflow exists in Phase 1 or is being built in Phase 2; the point of this section is to make sure the eventual design doesn't collide with tenant isolation.

> **Built in Phase 2B.1** (`docs/PLATFORM_OPERATOR_ARCHITECTURE.md`, `docs/adr/ADR-010-platform-operator-security-boundary.md`): exactly the principal type this section anticipated — `platform_operator`, no `tenant_id`, no RLS, its own permission grants (`platform_operator_permission`), its own session/token pair, its own audit trail (`security_event.scope = 'PLATFORM'`). This section's own description turned out to be an accurate advance specification; nothing about the built design contradicts it.

## 6a. Phase 2A implementation notes (post-implementation update)

The global-identity/Membership decision in §2.1 has been implemented — see `docs/PHASE_2A.md` for the full before/after. Three things worth recording here, where the actual implementation resolved a question this document left open or surfaced a new one:

- **Membership uniqueness** is a plain `UNIQUE(user_id, organization_id)`, not a partial index scoped by status — a user has exactly one Membership row per organization for life; status transitions (including reactivating a removed membership) reuse that row rather than creating a new one.
- **`security_user`'s RLS was removed entirely, not weakened** — a global Identity has no single `tenant_id` to filter by, so the tenant boundary for "who can see this user" moved to application code (joined through `membership`, which keeps its own RLS). See `docs/PHASE_2A.md`, "Global Identity RLS posture."
- **New open question surfaced, not resolved, by implementation**: `UsersService.activate()/suspend()/deactivate()` act on the Identity globally — suspending a user in one Tenant suspends them everywhere they have a Membership. Whether that's actually correct for a genuinely multi-tenant person is exactly an Organization Context question (§7 below cross-references it) — flagged as a known limitation in `docs/PHASE_2A.md` rather than guessed at.

## 7. What does not change

Session, Token *mechanism* (signing, rotation, revocation), Role/Permission/RolePermission *mechanism*, RLS pattern, audit event mechanism, OrganizationUnit hierarchy/closure table — all reused as-is. Phase 2 changes *who a User is scoped to* and *adds* Product/Application/Subscription/ServiceAccount; it does not redesign authentication mechanics, RLS, or the audit log.
