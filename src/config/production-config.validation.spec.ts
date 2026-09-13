import { InvalidProductionConfigurationError, validateProductionConfig } from './production-config.validation';

describe('validateProductionConfig (Phase 2D.9)', () => {
  it('passes through a valid, non-production config unchanged', () => {
    const config = { APP_ENV: 'development', OAUTH_ISSUER: 'https://identity.example.com' };
    expect(validateProductionConfig(config)).toBe(config);
  });

  it('rejects a malformed numeric env var regardless of environment', () => {
    expect(() => validateProductionConfig({ OAUTH_CLOCK_SKEW_SECONDS: 'not-a-number' })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects a zero or negative numeric env var', () => {
    expect(() => validateProductionConfig({ OAUTH_TOKEN_RATE_LIMIT_MAX: '0' })).toThrow(InvalidProductionConfigurationError);
    expect(() => validateProductionConfig({ OAUTH_TOKEN_RATE_LIMIT_MAX: '-5' })).toThrow(InvalidProductionConfigurationError);
  });

  it('accepts an unset numeric env var (the reading code applies its own documented default)', () => {
    expect(() => validateProductionConfig({})).not.toThrow();
  });

  it('accepts a valid positive numeric env var', () => {
    expect(() => validateProductionConfig({ OAUTH_CLOCK_SKEW_SECONDS: '30' })).not.toThrow();
  });

  it('rejects production config with a missing OAUTH_ISSUER', () => {
    expect(() => validateProductionConfig({ APP_ENV: 'production', OAUTH_PRIVATE_KEY: 'x' })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with OAUTH_ISSUER left as the example placeholder', () => {
    expect(() => validateProductionConfig({ APP_ENV: 'production', OAUTH_ISSUER: 'https://identity.example.com', OAUTH_PRIVATE_KEY: 'x' })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with a missing OAUTH_PRIVATE_KEY', () => {
    expect(() => validateProductionConfig({ APP_ENV: 'production', OAUTH_ISSUER: 'https://real-issuer.example.org', JWT_ACCESS_SECRET: 'a'.repeat(32), DATABASE_URL: 'postgresql://identity_app:real-secret@db:5432/identity_platform_db' })).toThrow(
      InvalidProductionConfigurationError,
    );
  });

  const VALID_PRODUCTION_CONFIG = {
    APP_ENV: 'production',
    OAUTH_ISSUER: 'https://real-issuer.example.org',
    OAUTH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgresql://identity_app:a-real-secret@db.internal:5432/identity_platform_db',
    CORS_ALLOWED_ORIGINS: 'https://app.travelos.com,https://app.healthcare.example.com',
  };

  it('accepts a fully valid production config', () => {
    expect(() => validateProductionConfig({ ...VALID_PRODUCTION_CONFIG })).not.toThrow();
  });

  it('never rejects a placeholder OAUTH_ISSUER outside production', () => {
    expect(() => validateProductionConfig({ APP_ENV: 'test', OAUTH_ISSUER: 'https://identity.example.com' })).not.toThrow();
    expect(() => validateProductionConfig({ APP_ENV: 'development', OAUTH_ISSUER: 'https://identity.example.com' })).not.toThrow();
  });

  // --- Phase 2D.11 (docs/PRODUCTION_READINESS.md §Configuration) ---

  it('rejects production config with a missing JWT_ACCESS_SECRET', () => {
    const { JWT_ACCESS_SECRET: _omit, ...rest } = VALID_PRODUCTION_CONFIG;
    expect(() => validateProductionConfig({ ...rest })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with JWT_ACCESS_SECRET left as the example placeholder', () => {
    expect(() => validateProductionConfig({ ...VALID_PRODUCTION_CONFIG, JWT_ACCESS_SECRET: 'replace-with-a-real-secret-min-32-chars' })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(() => validateProductionConfig({ ...VALID_PRODUCTION_CONFIG, JWT_ACCESS_SECRET: 'too-short' })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_PRODUCTION_CONFIG;
    expect(() => validateProductionConfig({ ...rest })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with DATABASE_URL still carrying the local-dev example password', () => {
    expect(() => validateProductionConfig({ ...VALID_PRODUCTION_CONFIG, DATABASE_URL: 'postgresql://identity_app:changeme@localhost:5434/identity_platform_db' })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects an OAUTH_CLOCK_SKEW_SECONDS above the 300-second ceiling, in any environment', () => {
    expect(() => validateProductionConfig({ OAUTH_CLOCK_SKEW_SECONDS: '301' })).toThrow(InvalidProductionConfigurationError);
    expect(() => validateProductionConfig({ OAUTH_CLOCK_SKEW_SECONDS: '300' })).not.toThrow();
  });

  it('rejects an OAUTH_AUTHORIZATION_CODE_TTL_SECONDS above the 600-second ceiling, in any environment', () => {
    expect(() => validateProductionConfig({ OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: '601' })).toThrow(InvalidProductionConfigurationError);
    expect(() => validateProductionConfig({ OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: '600' })).not.toThrow();
  });

  it('validates the legacy JWT/session TTL env vars the same way the OAuth ones already were', () => {
    expect(() => validateProductionConfig({ JWT_ACCESS_TOKEN_TTL: 'not-a-number' })).toThrow(InvalidProductionConfigurationError);
    expect(() => validateProductionConfig({ JWT_REFRESH_TOKEN_TTL: '0' })).toThrow(InvalidProductionConfigurationError);
    expect(() => validateProductionConfig({ PLATFORM_ACCESS_TOKEN_TTL: '900' })).not.toThrow();
  });

  it('rejects production config with a missing CORS_ALLOWED_ORIGINS', () => {
    const { CORS_ALLOWED_ORIGINS: _omit, ...rest } = VALID_PRODUCTION_CONFIG;
    expect(() => validateProductionConfig({ ...rest })).toThrow(InvalidProductionConfigurationError);
  });

  it('rejects production config with a wildcard CORS_ALLOWED_ORIGINS', () => {
    expect(() => validateProductionConfig({ ...VALID_PRODUCTION_CONFIG, CORS_ALLOWED_ORIGINS: '*' })).toThrow(InvalidProductionConfigurationError);
  });
});
