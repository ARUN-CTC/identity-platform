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
    expect(() => validateProductionConfig({ APP_ENV: 'production', OAUTH_ISSUER: 'https://real-issuer.example.org' })).toThrow(InvalidProductionConfigurationError);
  });

  it('accepts a fully valid production config', () => {
    expect(() =>
      validateProductionConfig({
        APP_ENV: 'production',
        OAUTH_ISSUER: 'https://real-issuer.example.org',
        OAUTH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
      }),
    ).not.toThrow();
  });

  it('never rejects a placeholder OAUTH_ISSUER outside production', () => {
    expect(() => validateProductionConfig({ APP_ENV: 'test', OAUTH_ISSUER: 'https://identity.example.com' })).not.toThrow();
    expect(() => validateProductionConfig({ APP_ENV: 'development', OAUTH_ISSUER: 'https://identity.example.com' })).not.toThrow();
  });
});
