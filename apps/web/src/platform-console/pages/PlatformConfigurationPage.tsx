import { PlatformApiGapPage } from "../components/PlatformApiGapPage";

/**
 * Phase 2UI.3 — per the governing brief's own §26: never build arbitrary
 * configuration editing, and never expose a frontend path to change JWT
 * secrets/private keys/database configuration/environment secrets/runtime
 * cryptographic material unless an explicitly designed secure backend
 * workflow exists. No such workflow exists in this backend at all — every
 * production configuration value is an environment variable, validated at
 * boot by validateProductionConfig() (docs/PRODUCTION_READINESS.md §A),
 * never readable or writable via any API. This page states that plainly
 * rather than building a fake settings form.
 */
export default function PlatformConfigurationPage() {
  return (
    <PlatformApiGapPage
      title="Configuration"
      description="Platform-wide runtime configuration."
      gapDescription="Deliberately not exposed here — every production configuration value (JWT secrets, the OAuth signing key, database connection, CORS allow-list) is an environment variable set at deploy time and validated at boot, never readable or editable through any API. This is a security decision, not a missing feature."
    />
  );
}
