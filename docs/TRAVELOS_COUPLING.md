# TravelOS Coupling Report

**Phase:** 1 — Project Isolation & Source Extraction
**Purpose:** for every component copied (or considered for copying) from TravelOS, document exactly what it depended on in TravelOS and what was done about it. This is a documentation pass, not a redesign — per the Phase 1 brief, coupling is recorded here, not heavily refactored.

| Component | TravelOS Dependency | Severity | Action Taken |
|---|---|---|---|
| `SecurityUser` (User) | `Tenant` (FK only) | Low | Extracted as-is; `Tenant` extracted alongside in trimmed form |
| `SecurityRole`/`SecurityPermission`/`SecurityRolePermission`/`SecurityUserRole` (Role/Permission) | `Tenant`, `Organization` (FK only); seed data referenced TravelOS-specific role names (`AGENT`) and ~150 TravelOS permission codes | Medium | Extracted mechanism as-is; reseeded with product-neutral role names (`MEMBER` instead of `AGENT`) and a minimal, product-agnostic permission subset (see `IDENTITY_SOURCE_INVENTORY.md`) |
| `SecuritySession`/`SecurityRefreshToken` (Session/Token) | `Tenant`, `SecurityUser`, `Organization` (FK only) | Low | Extracted as-is |
| `SecurityPasswordResetToken`/`SecurityUserInvitationToken` | `Tenant`, `SecurityUser` (FK only) | Low | Extracted as-is |
| `SecurityEvent`/`SecurityLoginAttempt` (Audit) | `Tenant`, `SecurityUser` (FK only) | Low | Extracted as-is |
| `AuthenticationService` | `UsersService`, `TokenService`, `SessionsService`, `UserRolesService` (all reusable); reads `PLATFORM_EMAIL_*`-style env only indirectly via injected email service for the forgot-password flow | Low | Extracted; forgot-password email send is stubbed to a `MailerService` interface with a console-log dev implementation (see `PHASE_1.md` — email provider not part of the reusable identity core) |
| `UserInvitationsService` | Same email-sending dependency as above | Low | Same stub treatment |
| `OrganizationAccessService` | `UserRolesService.resolveGrants()` (reusable) | Low | Extracted as-is |
| `Organization` | `OrganizationType`, `Tenant` (reusable); **`Currency`/`Language`/`Timezone`** (TravelOS Foundation domain, not extracted); back-relations to `HolidayCalendar`/`FiscalYear`/`OrganizationSetting`/`CostCenter`/`OrganizationSequence`/`WorkingHours` (TravelOS-operations domains, not extracted) | Medium | `currencyId`/`languageId`/`timezoneId` fields and all excluded-domain back-relations dropped from the copied model |
| `OrganizationUnit` | `OrganizationUnitType`, `Organization`, `Tenant` (reusable); `costCenterId` FK, `workingHours`/`holidayCalendarAssignments` back-relations (excluded domains) | Medium | Excluded-domain fields/relations dropped |
| `Tenant` | Back-relations into ~20 TravelOS product domains (documents, foundation, notifications, communications, subscriptions, features, configuration, taxes, sequences, API keys, webhooks, file storage, ...) | High (as a whole model) | Rewritten from scratch with only the core tenant fields (code/name/legal fields/status/lifecycle timestamps) and back-relations limited to the identity models actually included in this platform |
| RLS trigger/policy infrastructure | None — genuinely product-agnostic already (`current_tenant_id()`/`current_user_id()` GUCs, `apply_tenant_rls(table)`) | None | Extracted near-verbatim |
| `RequestContextService` / CLS store | None — reads only `tenantId`/`userId`/`organizationId`/`roleCodes`/`permissionCodes` off the request, all generic | None | Extracted as-is |
| Bootstrap seed users | Hardcoded a real personal email address (`arunjadhav0111+...@gmail.com`) | Low (dev-only data, not code coupling) | Replaced with placeholder addresses in the copied seed |
| Booking/Ticketing/Itinerary/Hotel/Flight/Supplier/Travel-domain everything | Total — these ARE TravelOS | N/A | **Excluded entirely.** Not inspected further than confirming they are business-domain modules with no identity logic embedded. |
| WhatsApp/Email communication modules | Deep integration with TravelOS's own notification/queue infrastructure (BullMQ, provider webhooks) | N/A | **Excluded entirely.** The one identity-relevant touchpoint (an email needs to be sent for invitations/password-reset) is represented in this platform only as a swappable interface, not the TravelOS provider integration itself. |
| Foundation domain (Countries/Currencies/Languages/Timezones/Lookups) | Self-contained, genuinely reusable *reference data* — but not IAM | N/A | **Excluded from Phase 1** — not identity-core; a candidate for a later, separate "Reference Data" module in this platform if a product needs it, not bundled into Identity by default |
| Subscription Plans / Tenant Features / Configuration / Integration / TenantDomain | Platform billing/entitlement/product-config concerns layered on top of Tenant | N/A | **Excluded from Phase 1** — genuinely platform-level but not identity; a candidate for a separate "Billing/Entitlements" module later |

## Overall TravelOS Coupling Assessment: **LOW**

Every extracted component's *code* coupling to TravelOS was either none (FK-only relations to `Tenant`/`Organization`, which are themselves extracted) or mechanical (drop a field, change a seed value). No extracted service, controller, or repository imports a TravelOS product module (Travel/Booking/Communications/Documents/Foundation). The one **structural** dependency worth calling out explicitly: `Tenant` in TravelOS is a "god object" with dozens of back-relations across the whole product — that model was not copied as-is; it was rewritten minimally for this platform, scoped to only the domains this platform actually contains.
