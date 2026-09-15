# Data Ownership

## 1. The boundary

```text
Identity Platform Database (identity_platform_db)
        │
        ├── Identity data           (User/Identity, Credential)
        ├── Authentication data     (Session, RefreshToken, PasswordResetToken, InvitationToken)
        ├── Authorization data      (Role, Permission, RolePermission, grants)
        ├── Organization data       (Tenant, Organization, OrganizationUnit, Membership)
        ├── Product registration    (Product, Application, TenantProductSubscription, ServiceAccount)
        └── Security/audit data     (SecurityEvent, SecurityLoginAttempt)

Product Database (one per product: Travel DB, Health DB, Gym DB, ...)
        │
        ├── Product entities        (Booking, Patient, Workout, ...)
        └── Product business data   (everything that entity owns/references)
```

## 2. The rule

**Product databases must not become an alternate source of truth for identity.** A product may (and should) store a *reference* to an Identity Platform id — e.g. TravelOS's `Booking.customer_id` pointing at an Identity's `sub` — but must never store a copy of that Identity's password, roles, permissions, or organization membership as its own writable record. If a product needs "is this user still active" or "what is this user's display name" at query time, it either calls the Identity Platform's API or maintains a read-only, platform-driven cache (webhook/event-fed, never independently editable) — never a second, independently-maintained copy that could drift from or be edited out of sync with the Identity Platform's own record.

Concretely, this means:

- A product may cache `{user_id, display_name, email}` locally for join-performance reasons, refreshed from the Identity Platform (poll or webhook on `USER_PROFILE_UPDATED`).
- A product must **not** have its own "is admin" boolean column that a product-side admin screen can flip directly — that would create a second, unsynchronized authorization source of truth, exactly the "shared product domain code / shared source of truth" pattern the whole Phase 2 boundary exists to prevent.
- A product must **not** write back into the Identity Platform's database directly (no shared connection string, no cross-database query, no ORM pointed at both schemas) — the only write path is the API (`docs/API_BOUNDARY.md`).

## 3. Why this matters more than it sounds

The single fastest way for a "product-agnostic Identity Platform" to quietly become "TravelOS's identity module with extra steps" is for TravelOS's database to grow its own authorization shortcuts that bypass the Identity Platform API under time pressure. This document exists so that pressure is refused by design, not by discipline: no shared connection, no shared ORM model, no filesystem dependency between repositories (all already true per `docs/PROJECT_ISOLATION.md`, restated here as a Phase 2 commitment that must survive every future product's onboarding, not just TravelOS's).

## 4. Ownership answers restated (Phase 2 success criteria)

| Question | Answer |
|---|---|
| Who owns identity? | Identity Platform |
| Who authenticates users? | Identity Platform |
| Who owns core IAM authorization? | Identity Platform |
| Who owns product-specific permissions? | Each Product authors them; Identity Platform stores/catalogs them (`AUTHORIZATION_ARCHITECTURE.md` §2) |
| Who owns product business data? | Each Product, in its own database |
| Does any product share the Identity Platform database? | No |
| Does any product import Identity Platform domain code directly? | No — API/SDK only (`SDK_STRATEGY.md`) |
