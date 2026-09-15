import { HttpStatus, Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { AppException } from '../../../common';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** RFC 3986 §3.1 scheme syntax: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) */
const VALID_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i;

/**
 * Phase 2D.2 (docs/OAUTH_ARCHITECTURE.md §4, docs/PHASE_2D_THREAT_MODEL.md
 * #4/#27) — format validation for a single redirect URI, applied at
 * REGISTRATION time only (never at the exact-match runtime check below,
 * which does no parsing at all — see RedirectUriPolicy.isRedirectUriAllowed).
 * Deliberately conservative and explicit rather than relying on
 * `class-validator`'s built-in `IsUrl` (too permissive for this purpose —
 * it does not reject fragments, wildcards, or enforce the loopback-only
 * exception for http://).
 */
export function validateRedirectUriFormat(uri: string): void {
  if (uri.includes('*')) {
    throw new AppException('INVALID_REDIRECT_URI', `Wildcard redirect URIs are not permitted: '${uri}'`, HttpStatus.BAD_REQUEST);
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new AppException('INVALID_REDIRECT_URI', `Not an absolute, well-formed URI: '${uri}'`, HttpStatus.BAD_REQUEST);
  }

  if (parsed.hash) {
    throw new AppException('INVALID_REDIRECT_URI', `Redirect URI must not contain a fragment: '${uri}'`, HttpStatus.BAD_REQUEST);
  }
  if (parsed.username || parsed.password) {
    throw new AppException('INVALID_REDIRECT_URI', `Redirect URI must not contain userinfo (user:pass@): '${uri}'`, HttpStatus.BAD_REQUEST);
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme === 'http') {
    if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new AppException(
        'INVALID_REDIRECT_URI',
        `http:// redirect URIs are only permitted for localhost/127.0.0.1 development use, not '${uri}' — production applications require https://`,
        HttpStatus.BAD_REQUEST,
      );
    }
  } else if (scheme !== 'https' && !VALID_SCHEME_PATTERN.test(scheme)) {
    // A custom mobile/native scheme (e.g. `com.travelos.app://callback`) is
    // otherwise permitted (docs/OAUTH_ARCHITECTURE.md §4) — only rejected if
    // it isn't even syntactically a valid URI scheme token.
    throw new AppException('INVALID_REDIRECT_URI', `Invalid URI scheme: '${scheme}'`, HttpStatus.BAD_REQUEST);
  }
}

/**
 * Phase 2D.2 — reusable redirect-URI policy. Registration-time format
 * validation (above) is entirely separate from the runtime exact-match
 * check below — the latter is deliberately dumb (no parsing, no
 * normalization, a single `Array.includes`) precisely to avoid any
 * parser-differential ambiguity between what was registered and what is
 * later presented (docs/OAUTH_ARCHITECTURE.md §4, "exact-match only —
 * never startsWith/includes/substring/wildcard matching").
 */
@Injectable()
export class RedirectUriPolicy {
  validateRedirectUrisForRegistration(uris: string[]): void {
    for (const uri of uris) {
      validateRedirectUriFormat(uri);
    }
    if (new Set(uris).size !== uris.length) {
      throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'redirectUris must not contain duplicate entries', HttpStatus.BAD_REQUEST);
    }
  }

  /** Runtime (future `/authorize`): EXACT string match only. */
  isRedirectUriAllowed(application: Pick<Application, 'redirectUris'>, redirectUri: string): boolean {
    return application.redirectUris.includes(redirectUri);
  }
}
