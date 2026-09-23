import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: { sign: jest.fn(), verify: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                JWT_ACCESS_TOKEN_TTL: '900',
                JWT_REFRESH_TOKEN_TTL: '2592000',
                JWT_REFRESH_TOKEN_TTL_SHORT: '3600',
              })[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  it('round-trips a refresh token: generate -> parse -> hash matches', () => {
    const tenantId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
    const { plain, hash } = service.generateRefreshToken(tenantId);

    const parsed = service.parseRefreshToken(plain);
    expect(parsed).not.toBeNull();
    expect(parsed!.tenantId).toBe(tenantId);
    expect(service.hashRefreshToken(parsed!.secret)).toBe(hash);
  });

  it('parseRefreshToken returns null for a malformed token', () => {
    expect(service.parseRefreshToken('not-a-valid-token')).toBeNull();
    expect(service.parseRefreshToken('')).toBeNull();
  });

  it('accessTokenTtlSeconds coerces the numeric env var from a string', () => {
    expect(service.accessTokenTtlSeconds).toBe(900);
  });

  describe('browser session secret (Phase 2UI.5A)', () => {
    it('round-trips: generate -> parse -> hash matches, same shape as a refresh token', () => {
      const tenantId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
      const { plain, hash } = service.generateBrowserSessionSecret(tenantId);

      const parsed = service.parseBrowserSessionSecret(plain);
      expect(parsed).not.toBeNull();
      expect(parsed!.tenantId).toBe(tenantId);
      expect(service.hashBrowserSessionSecret(parsed!.secret)).toBe(hash);
    });

    it('parseBrowserSessionSecret returns null for a malformed cookie value', () => {
      expect(service.parseBrowserSessionSecret('not-a-valid-cookie')).toBeNull();
      expect(service.parseBrowserSessionSecret('')).toBeNull();
    });

    it('two secrets generated for the same tenant never collide', () => {
      const tenantId = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
      const a = service.generateBrowserSessionSecret(tenantId);
      const b = service.generateBrowserSessionSecret(tenantId);
      expect(a.plain).not.toBe(b.plain);
      expect(a.hash).not.toBe(b.hash);
    });

    it('browserSessionSecretTtlSecondsFor mirrors refreshTokenTtlSecondsFor exactly', () => {
      expect(service.browserSessionSecretTtlSecondsFor(true)).toBe(service.refreshTokenTtlSecondsFor(true));
      expect(service.browserSessionSecretTtlSecondsFor(false)).toBe(service.refreshTokenTtlSecondsFor(false));
      expect(service.browserSessionSecretTtlSecondsFor(true)).not.toBe(service.browserSessionSecretTtlSecondsFor(false));
    });
  });

  describe('pending authorization reference (Phase 2UI.5A)', () => {
    it('generates a reference whose hash is reproducible from the plain value, with no tenant prefix', () => {
      const { plain, hash } = service.generatePendingAuthorizationReference();
      expect(plain.includes('.')).toBe(false);
      expect(service.hashBrowserSessionSecret(plain)).toBe(hash);
    });

    it('two references never collide', () => {
      const a = service.generatePendingAuthorizationReference();
      const b = service.generatePendingAuthorizationReference();
      expect(a.plain).not.toBe(b.plain);
      expect(a.hash).not.toBe(b.hash);
    });

    it('pendingAuthorizationTtlSeconds defaults to 600 when unconfigured', () => {
      expect(service.pendingAuthorizationTtlSeconds).toBe(600);
    });
  });
});
