import { HttpStatus, Injectable } from '@nestjs/common';
import { Application } from '@prisma/client';
import { AppException } from '../../../common';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Phase 2D.2 (docs/OAUTH_ARCHITECTURE.md, docs/EXTERNAL_AUTH_ARCHITECTURE.md)
 * — an origin is a browser CORS concern (`scheme://host[:port]`, no path, no
 * query, no fragment), deliberately validated separately from a redirect
 * URI (a full, path-bearing URI, validated by RedirectUriPolicy) — the two
 * serve different security purposes and must never be conflated: an origin
 * being allowed to make a cross-origin request does not, by itself, permit
 * a redirect to that origin, and vice versa.
 */
export function validateOriginFormat(origin: string): void {
  if (origin === '*' || origin.includes('*')) {
    throw new AppException('INVALID_APPLICATION_CONFIGURATION', `Wildcard origins are not permitted: '${origin}'`, HttpStatus.BAD_REQUEST);
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AppException('INVALID_APPLICATION_CONFIGURATION', `Not a well-formed origin: '${origin}'`, HttpStatus.BAD_REQUEST);
  }

  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new AppException('INVALID_APPLICATION_CONFIGURATION', `An origin must not include a path, query, or fragment: '${origin}'`, HttpStatus.BAD_REQUEST);
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme === 'http') {
    if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new AppException(
        'INVALID_APPLICATION_CONFIGURATION',
        `http:// origins are only permitted for localhost/127.0.0.1 development use, not '${origin}'`,
        HttpStatus.BAD_REQUEST,
      );
    }
  } else if (scheme !== 'https') {
    throw new AppException('INVALID_APPLICATION_CONFIGURATION', `An origin must use https:// (or http:// for localhost development): '${origin}'`, HttpStatus.BAD_REQUEST);
  }
}

/** Phase 2D.2 — reusable, exact-match origin policy, same discipline as RedirectUriPolicy. */
@Injectable()
export class OriginPolicy {
  validateOriginsForRegistration(origins: string[]): void {
    for (const origin of origins) {
      validateOriginFormat(origin);
    }
    if (new Set(origins).size !== origins.length) {
      throw new AppException('INVALID_APPLICATION_CONFIGURATION', 'allowedOrigins must not contain duplicate entries', HttpStatus.BAD_REQUEST);
    }
  }

  isOriginAllowed(application: Pick<Application, 'allowedOrigins'>, origin: string): boolean {
    return application.allowedOrigins.includes(origin);
  }
}
