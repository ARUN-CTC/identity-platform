import { Application, Product } from '@prisma/client';
import { OAuthApplicationPolicyService, OAuthEligibilityError } from './oauth-eligibility.policy';
import { ApplicationAudiencePolicy } from './audience.policy';
import { ApplicationGrantPolicy } from './grant-type.policy';
import { RedirectUriPolicy } from './redirect-uri.policy';
import { ApplicationScopePolicy } from './scope.policy';

function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    productId: 'product-1',
    name: 'Test App',
    clientId: 'cli_test',
    clientSecretHash: null,
    clientType: 'CONFIDENTIAL',
    status: 'ACTIVE',
    redirectUris: ['https://app.example.com/callback'],
    allowedOrigins: [],
    grantTypes: ['authorization_code'],
    allowedScopes: ['travel.read'],
    audiences: ['travel-api'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    secretCreatedAt: null,
    secretRevokedAt: null,
    createdAt: new Date(),
    createdBy: null,
    updatedAt: null,
    updatedBy: null,
    version: 1n,
    ...overrides,
  } as Application;
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Travel',
    slug: 'travelos',
    description: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    createdBy: null,
    updatedAt: null,
    updatedBy: null,
    version: 1n,
    ...overrides,
  } as Product;
}

describe('OAuthApplicationPolicyService', () => {
  function build(application: Application | null, product: Product) {
    const applicationsRepo = { findByClientId: jest.fn().mockResolvedValue(application) };
    const productsService = { findOne: jest.fn().mockResolvedValue(product) };
    const service = new OAuthApplicationPolicyService(
      applicationsRepo as never,
      productsService as never,
      new ApplicationGrantPolicy(),
      new ApplicationScopePolicy(),
      new ApplicationAudiencePolicy(),
      new RedirectUriPolicy(),
    );
    return { service, applicationsRepo, productsService };
  }

  it('returns the application when every requested facet is allowed', async () => {
    const { service } = build(makeApplication(), makeProduct());
    const result = await service.checkEligibility({
      clientId: 'cli_test',
      grantType: 'authorization_code',
      requestedScopes: ['travel.read'],
      requestedAudience: 'travel-api',
      redirectUri: 'https://app.example.com/callback',
    });
    expect(result.clientId).toBe('cli_test');
  });

  it('denies an unknown client_id', async () => {
    const { service } = build(null, makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_unknown' })).rejects.toMatchObject({ reason: 'application_not_found' } as Partial<OAuthEligibilityError>);
  });

  it('denies a DISABLED application', async () => {
    const { service } = build(makeApplication({ status: 'DISABLED' }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test' })).rejects.toMatchObject({ reason: 'application_inactive' });
  });

  it('denies a SUSPENDED application', async () => {
    const { service } = build(makeApplication({ status: 'SUSPENDED' }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test' })).rejects.toMatchObject({ reason: 'application_inactive' });
  });

  it("denies when the application's product is inactive", async () => {
    const { service } = build(makeApplication(), makeProduct({ status: 'DISABLED' }));
    await expect(service.checkEligibility({ clientId: 'cli_test' })).rejects.toMatchObject({ reason: 'product_inactive' });
  });

  it('denies a grant type not in the allow-list', async () => {
    const { service } = build(makeApplication({ grantTypes: ['authorization_code'] }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test', grantType: 'client_credentials' })).rejects.toMatchObject({ reason: 'grant_type_not_allowed' });
  });

  it('denies a requested scope not in the allow-list', async () => {
    const { service } = build(makeApplication({ allowedScopes: ['travel.read'] }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test', requestedScopes: ['travel.admin'] })).rejects.toMatchObject({ reason: 'scope_not_allowed' });
  });

  it('denies a requested audience not in the allow-list', async () => {
    const { service } = build(makeApplication({ audiences: ['travel-api'] }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test', requestedAudience: 'healthcare-api' })).rejects.toMatchObject({ reason: 'audience_not_allowed' });
  });

  it('denies a redirect_uri not exactly matching the allow-list', async () => {
    const { service } = build(makeApplication({ redirectUris: ['https://app.example.com/callback'] }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test', redirectUri: 'https://evil.com/callback' })).rejects.toMatchObject({ reason: 'redirect_uri_not_allowed' });
  });

  it('does not check a facet that was not requested (undefined params are skipped, not treated as empty/denied)', async () => {
    const { service } = build(makeApplication({ grantTypes: [], allowedScopes: [], audiences: [], redirectUris: [] }), makeProduct());
    await expect(service.checkEligibility({ clientId: 'cli_test' })).resolves.toBeDefined();
  });
});
