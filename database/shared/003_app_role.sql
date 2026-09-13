-- A dedicated, non-superuser role for the application to connect as.
--
-- PostgreSQL superusers and table owners bypass Row-Level Security. Every
-- table in this schema is owned by whichever role ran build-schema.sh
-- (typically the `postgres` superuser locally). If the application also
-- connected as that role, every RLS policy would be purely decorative.
-- `identity_app` owns nothing and isn't a superuser, so it's unconditionally
-- subject to RLS. Migrations/seeds/schema changes run as the elevated owner
-- role; only the running application's DATABASE_URL should point at
-- identity_app. Pattern copied from TravelOS's own
-- packages/database/shared/roles/001_app_role.sql (travelos_app) —
-- genuinely product-agnostic, classified REUSABLE.
--
-- SECURITY: the password below is a placeholder for local development
-- only. Change it out-of-band (`ALTER ROLE identity_app PASSWORD '...';`)
-- before any shared/non-local use — never commit a real password here.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'identity_app') THEN
        CREATE ROLE identity_app
            LOGIN
            PASSWORD 'changeme'
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO identity_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO identity_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO identity_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO identity_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO identity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO identity_app;
