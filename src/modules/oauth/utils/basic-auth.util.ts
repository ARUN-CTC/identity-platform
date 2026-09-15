/**
 * Phase 2D.4 (brief §9 "do not log the Authorization header") — parses an
 * HTTP Basic `Authorization` header (RFC 7617) into a `client_id`/
 * `client_secret` pair for `client_secret_basic` authentication
 * (`docs/adr/ADR-018-application-trust-client-types.md`,
 * `TokenEndpointAuthMethodPolicy`). Returns `null` for anything malformed
 * — the caller (`ClientCredentialsService`) turns that into a generic
 * `invalid_client` error, never a parse-error message that could hint at
 * what was wrong with the header's own syntax.
 */
export interface BasicAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export function parseBasicAuthHeader(authorizationHeader: string | undefined): BasicAuthCredentials | null {
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) {
    return null;
  }
  const encoded = authorizationHeader.slice('Basic '.length).trim();
  if (!encoded) {
    return null;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    return null;
  }

  const clientId = decoded.slice(0, separatorIndex);
  const clientSecret = decoded.slice(separatorIndex + 1);
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}
