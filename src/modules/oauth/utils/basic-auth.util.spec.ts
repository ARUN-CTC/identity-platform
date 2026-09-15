import { parseBasicAuthHeader } from './basic-auth.util';

function encode(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

describe('parseBasicAuthHeader (Phase 2D.4)', () => {
  it('parses a well-formed Basic header', () => {
    const result = parseBasicAuthHeader(encode('cli_abc123', 's3cr3t'));
    expect(result).toEqual({ clientId: 'cli_abc123', clientSecret: 's3cr3t' });
  });

  it('handles a client secret that itself contains a colon (only the FIRST colon is the separator)', () => {
    const result = parseBasicAuthHeader(encode('cli_abc123', 'sec:ret:with:colons'));
    expect(result).toEqual({ clientId: 'cli_abc123', clientSecret: 'sec:ret:with:colons' });
  });

  it('returns null for a missing header', () => {
    expect(parseBasicAuthHeader(undefined)).toBeNull();
  });

  it('returns null for a non-Basic scheme (e.g. Bearer)', () => {
    expect(parseBasicAuthHeader('Bearer sometoken')).toBeNull();
  });

  it('returns null for empty Basic credentials', () => {
    expect(parseBasicAuthHeader('Basic ')).toBeNull();
    expect(parseBasicAuthHeader('Basic')).toBeNull();
  });

  it('returns null for non-base64 garbage', () => {
    expect(parseBasicAuthHeader('Basic not-actually-base64!!!')).toBeNull();
  });

  it('returns null when the decoded value has no colon separator at all', () => {
    const noColon = Buffer.from('justastringwithnocolon').toString('base64');
    expect(parseBasicAuthHeader(`Basic ${noColon}`)).toBeNull();
  });

  it('returns null when either half is empty (":secret" or "id:")', () => {
    const missingId = Buffer.from(':secret').toString('base64');
    const missingSecret = Buffer.from('id:').toString('base64');
    expect(parseBasicAuthHeader(`Basic ${missingId}`)).toBeNull();
    expect(parseBasicAuthHeader(`Basic ${missingSecret}`)).toBeNull();
  });
});
