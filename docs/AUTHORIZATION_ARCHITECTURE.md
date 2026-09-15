# Authorization Architecture

## 1. Vocabulary

| Term | Definition | Owner |
|---|---|---|
| Role | A named, assignable bundle of Permissions | Identity Platform (mechanism); content can be authored by a Tenant admin (custom roles) or a Product (suggested/default roles) |
| Permission | A single grantable, namespaced action string (`resource.action` under a namespace prefix) | Identity Platform (core namespace) / Product (product namespace) — see §2 |
| Scope | A coarse, consent-level capability granted to an **Application**, not a user (e.g. "this client may call the travel API at all") | Identity Platform, set at Application registration |
| Policy | A future conditional/attribute-based rule evaluated alongside a role/permission check (e.g. "only during business hours," "only for records the user owns") | Identity Platform (mechanism); not built in Phase 2 |
| Resource | The thing an action applies to (`booking`, `patient`, `organization`) — implicit in a permission code's second segment, not a separate stored entity in Phase 2 |
| Action | The verb (`read`, `create`, `manage`) — implicit in a permission code's third segment |
| Organization | The scope at which a role grant can be limited (`docs/IDENTITY_DOMAIN_MODEL.md`) | Identity Platform |
| Product | The namespace boundary for non-core permissions | Each Product |

Role vs. Permission vs. Scope, concretely: a **Role** ("Travel Booking Agent") bundles **Permissions** (`travel.booking.create`, `travel.booking.read`); a **Scope** (`travel:api`) is a property of the *Application* the request came through, checked in addition to the user's own roles/permissions — a fully-permissioned user calling through an Application that was never granted the `travel:api` scope is still refused, and a correctly-scoped Application cannot grant its own users permissions they don't otherwise hold. The two checks are independent and both must pass.

## 2. Core vs. product permission catalog

**Decision: a single physical catalog, two namespaces, two authoring authorities — the "hybrid" of Step 13's three options, and it is the only one of the three that doesn't force a bad trade-off.**

- **Core permissions** — prefix `identity.`: `identity.user.read`, `identity.user.manage`, `identity.organization.read`, `identity.organization.manage`, `identity.role.manage`, `identity.session.manage`, `identity.audit.read`. Authored exclusively by the Identity Platform itself. These are the only permissions any part of the Identity Platform's own admin API (Step 9) enforces.
- **Product permissions** — prefix `<product-slug>.`: `travel.booking.create`, `healthcare.patient.read`, `gym.member.manage`. Authored (defined, meaning owned) exclusively by each Product. The Identity Platform never interprets what `travel.booking.create` *means* — it is an opaque, namespaced string as far as the platform's own code is concerned.

**Why store them in one physical catalog rather than each product keeping its own:** the whole point of a shared Identity Platform is one place for a Tenant admin to build a role ("Travel + Gym Manager for the Downtown Branch") mixing permissions from multiple products, and one place to audit "who can do what" across the entire account. If each product kept its own permission store, role composition across products would require the Identity Platform to fan out to N product APIs on every role-edit and every authorization check — reintroducing the "shared thing multiple systems must agree on in real time" problem the whole architecture exists to avoid.

**Registration, not central hand-authoring:** a Product registers its own permission codes into the shared catalog via a dedicated, product-scoped write path (`POST /v1/products/{id}/permissions`, authenticated as that Product's ServiceAccount — see `docs/API_BOUNDARY.md`), rather than the Identity Platform's team hand-typing every product's permission list. This is "registered centrally, managed by the product" — option 3 (hybrid) from Step 13, made concrete:

1. **Registered centrally** — one table, one query surface, one role-composition UI.
2. **Managed by the product** — only the owning Product's ServiceAccount can create/update/retire permissions under its own namespace prefix; the Identity Platform enforces the namespace boundary (a `gym` ServiceAccount cannot register `travel.*` codes) but never authors the content.
3. Pure "hybrid," not a third separate thing — this *is* the hybrid; there is no additional model needed.

This directly satisfies the brief's requirement: "product permissions must not pollute the core identity catalog" (they don't — different prefix, different authoring authority, and the Identity Platform's own code only ever hard-codes and enforces the `identity.*` set) while still giving Tenant admins one unified place to manage roles.

## 3. Enforcement split

- **Core permission checks** (`identity.*`) — enforced entirely inside the Identity Platform's own API (its `PermissionsGuard`, unchanged mechanism from Phase 1).
- **Product permission checks** (`travel.*`, etc.) — enforced by the **Product itself**, against claims/data it already has (roles from the token, or a resolved permission set from `/v1/authorize` or its own short-TTL cache — `docs/TOKEN_ARCHITECTURE.md` §6). The Identity Platform does not, and structurally cannot, enforce "can this user create a booking" — it has no booking-domain knowledge and must not acquire any (`docs/IDENTITY_DOMAIN_MODEL.md`'s prime directive: no product business logic in the Identity Platform).

```text
Identity Platform
        │
        ├── Core IAM permissions        (defined + enforced here)
        │
        └── Product authorization framework   (catalog storage + role composition here;
                     │                          actual enforcement happens in each product)
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       TravelOS  Healthcare    Gym
   (enforces travel.*) (enforces healthcare.*) (enforces gym.*)
```

## 3a. Membership is now a precondition for any grant to be effective (implemented in Phase 2A)

`docs/PHASE_2A.md` implemented the global-identity/Membership change this document's core vs. product split assumed was already settled ground. One consequence worth recording here: a `Role` grant (`SecurityUserRole`) is now necessary but not sufficient — it is only *effective* when the granted user also holds an ACTIVE `Membership` covering the same scope (the tenant, for a tenant-wide grant; the specific organization, for an organization-scoped one). This is enforced in `UserRolesRepository.resolveGrants()`, not a new mechanism layered on top of RBAC — RBAC itself (Role/Permission/RolePermission, the grant-ceiling rule below) is unchanged.

## 4. Grant-ceiling rule (carried over from Phase 1, generalized)

Phase 1's `UserRolesService` rule — a caller can only grant a role whose permissions they themselves already hold — is retained and generalized across namespaces without change: a Tenant admin who holds every `travel.*` permission (via some role) but no `healthcare.*` permission cannot grant a role bundling `healthcare.patient.read` to anyone, even within their own tenant. This is enforced entirely inside the Identity Platform (it only needs to compare permission *codes* as opaque strings, never their meaning) and is one of the most valuable reusable primitives called out in `docs/IDENTITY_SOURCE_INVENTORY.md`.

## 5. Policy (future)

Not built in Phase 2. Reserved as an optional evaluation step after a role/permission check passes: "is there also a condition attached" (ownership of the specific resource, time-of-day, IP allowlist). Would live entirely inside the Identity Platform's mechanism (a `Policy` bound to a `Role` or `Permission`), evaluated using only attributes the Identity Platform itself has (actor, tenant, organization, time) — anything requiring product-domain data (e.g. "only the assigned doctor can edit this record") is explicitly out of scope for the Identity Platform's policy engine and remains the Product's own enforcement responsibility, consistent with §3.
