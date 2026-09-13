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
          useValue: { get: (key: string) => ({ JWT_ACCESS_TOKEN_TTL: '900' })[key] },
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
});
