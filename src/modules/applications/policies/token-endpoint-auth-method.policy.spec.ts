import { TokenEndpointAuthMethodPolicy } from './token-endpoint-auth-method.policy';

describe('TokenEndpointAuthMethodPolicy', () => {
  const policy = new TokenEndpointAuthMethodPolicy();

  it('derives client_secret_basic for CONFIDENTIAL', () => {
    expect(policy.derive('CONFIDENTIAL')).toBe('client_secret_basic');
  });

  it('derives none for PUBLIC', () => {
    expect(policy.derive('PUBLIC')).toBe('none');
  });

  it('PASS: CONFIDENTIAL + client_secret_basic', () => {
    expect(policy.isValidCombination('CONFIDENTIAL', 'client_secret_basic')).toBe(true);
  });

  it('PASS: PUBLIC + none', () => {
    expect(policy.isValidCombination('PUBLIC', 'none')).toBe(true);
  });

  it('DENY: PUBLIC + client_secret_basic', () => {
    expect(policy.isValidCombination('PUBLIC', 'client_secret_basic')).toBe(false);
  });

  it('DENY: CONFIDENTIAL + none', () => {
    expect(policy.isValidCombination('CONFIDENTIAL', 'none')).toBe(false);
  });
});
