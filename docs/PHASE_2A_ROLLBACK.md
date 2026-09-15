# Phase 2A — Rollback Strategy

No production tenant data exists anywhere (Phase 1/2A remain dev-only — `docs/PHASE_2_BASELINE.md`), which makes this the cheapest possible point to have made this change and correspondingly simplifies rollback: there is no real customer data migration to reverse, only a development/test database and a code tree.

## 1. Database rollback

### Clean-bootstrap environments (the primary, tested path)

Any environment built via `db:build-schema` + `db:seed` (i.e., every environment so far) has no state worth preserving. Rollback is: revert the code (see §3), then rebuild from scratch:

```bash
git checkout <pre-Phase-2A-commit> -- database/ src/
npm run db:reset   # drops + recreates the public schema, rebuilds DDL, reseeds
```

Verified working in both directions during this phase: `db:reset` against the Phase 2A schema succeeded cleanly (see `docs/PHASE_2A.md`'s test-coverage section); the same command against the pre-Phase-2A DDL is equally deterministic since `build-schema.sh`/`seed.sh` have no conditional logic tied to which phase they represent.

### An environment that already applied the forward migration (`database/migrations/20260913120000_global_identity_and_membership.sql`)

No down-migration is written, per this project's own stated convention (`database/migrations/README.md`: "no down-migrations, write a new forward fix instead") — restated here as the applicable rollback procedure. To undo:

```sql
BEGIN;

-- Reverse security_user_invitation_token.organization_id
ALTER TABLE security_user_invitation_token DROP CONSTRAINT IF EXISTS security_user_invitation_token_organization_id_fkey;
DROP INDEX IF EXISTS idx_security_user_invitation_token_org;
ALTER TABLE security_user_invitation_token DROP COLUMN IF EXISTS organization_id;

-- Reverse security_user: restore tenant_id, RLS, and the old constraint.
-- Backfill tenant_id from the (now sole, pre-Phase-2A-guaranteed) membership
-- row per user — this is the one step that is NOT lossless if a user
-- gained a second membership (a different tenant) after Phase 2A shipped;
-- see "Irreversibility" below.
ALTER TABLE security_user ADD COLUMN tenant_id UUID;
UPDATE security_user u
SET tenant_id = (SELECT m.tenant_id FROM membership m WHERE m.user_id = u.id ORDER BY m.created_at ASC LIMIT 1);
ALTER TABLE security_user ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE security_user ADD CONSTRAINT security_user_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
CREATE INDEX idx_security_user_tenant ON security_user(tenant_id);
ALTER TABLE security_user DROP CONSTRAINT IF EXISTS uk_security_user_email;
ALTER TABLE security_user ADD CONSTRAINT uk_security_user_email UNIQUE (tenant_id, email);
ALTER TABLE security_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_user FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON security_user
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Drop membership entirely.
DROP TABLE IF EXISTS membership;

COMMIT;
```

Run this only after reverting the application code (§3) — the two must move together, since the code no longer knows how to read a `security_user.tenant_id` column once it's been dropped, and won't know what to do with a `membership` table once it's gone.

## 2. Irreversibility — the one real risk

If, between applying Phase 2A and rolling it back, any global Identity acquired a **second** Membership in a different Tenant (the entire point of this phase), the rollback's `tenant_id` backfill above picks the earliest membership arbitrarily and silently drops the Identity's access to every other tenant it had gained. This is a genuine, inherent one-way door — restoring the pre-Phase-2A model is only lossless if no Identity ever actually exercised the new multi-tenant capability. Mitigation: before rolling back, run

```sql
SELECT user_id, COUNT(DISTINCT tenant_id) FROM membership GROUP BY user_id HAVING COUNT(DISTINCT tenant_id) > 1;
```

and treat any non-empty result as a hard stop requiring a manual decision (which tenant does this person keep?), not an automatic rollback.

## 3. Application rollback

Standard code revert: `git revert` the Phase 2A commit(s), or `git checkout` the prior tag/commit for `src/` and `database/`. No feature flags were introduced and none are needed — the change is all-or-nothing by construction (a build against the old schema cannot run against the new one and vice versa, since Prisma's generated client is schema-shape-specific).

## 4. Seed rollback

`database/seeds/003_bootstrap_dev_tenant.sql` reverts along with the rest of `database/` in a code revert — no separate action needed. A freshly reset database after reverting produces the exact pre-Phase-2A bootstrap admin (tenant-scoped `security_user`, no `membership` table).

## 5. RLS rollback

Covered by §1's SQL above (`security_user` RLS re-enabled with its original policy) and by the clean-bootstrap path automatically (old DDL never removes RLS from `security_user` in the first place).

## 6. Risks summary

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multi-tenant Identity exists at rollback time | Low today (dev-only, no real usage yet) — grows over time | High (silent access loss for that person) | Pre-rollback query above; treat non-empty result as a manual-migration case, not an automatic rollback |
| Forward-migration SQL applied to a database with unexpected pre-existing duplicate emails across tenants | Low (only matters on a database with real historical multi-tenant duplicate-email data, which doesn't exist yet) | Migration refuses to run (explicit `RAISE EXCEPTION`, not a silent partial apply) | Already handled — see the migration's own safety check |
| A future phase (2B+) builds on the `membership` table before this rollback path is exercised even once for real | Low | Rollback SQL above would then also need to account for whatever 2B+ added | Re-verify this rollback doc's SQL whenever a later phase adds a hard dependency on `membership`/`security_user` shape |
