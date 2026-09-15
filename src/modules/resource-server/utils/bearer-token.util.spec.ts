import { extractBearerToken } from './bearer-token.util';

const VALID = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln';

describe('extractBearerToken (Phase 2D.5)', () => {
  it('accepts a well-formed Bearer header', () => {
    expect(extractBearerToken(`Bearer ${VALID}`)).toBe(VALID);
  });

  it('rejects a missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('rejects an empty header', () => {
    expect(extractBearerToken('')).toBeNull();
  });

  it('rejects Basic scheme', () => {
    expect(extractBearerToken('Basic Zm9vOmJhcg==')).toBeNull();
  });

  it('rejects Digest scheme', () => {
    expect(extractBearerToken('Digest username="foo"')).toBeNull();
  });

  it('rejects an unknown scheme', () => {
    expect(extractBearerToken(`Wombat ${VALID}`)).toBeNull();
  });

  it('rejects "Bearer" alone with no token', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
  });

  it('rejects "Bearer " with an empty/whitespace-only token', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken('Bearer    ')).toBeNull();
  });

  it('rejects malformed bearer syntax (not JWT-shaped)', () => {
    expect(extractBearerToken('Bearer only-one-segment')).toBeNull();
    expect(extractBearerToken('Bearer too.many.segments.here')).toBeNull();
    expect(extractBearerToken('Bearer abc..def')).toBeNull(); // empty middle segment
  });

  it('rejects an array value (Node/Express representing a duplicated header)', () => {
    expect(extractBearerToken([`Bearer ${VALID}`, `Bearer ${VALID}`])).toBeNull();
  });

  it('rejects a comma-joined value (the other shape Node may collapse duplicate headers into)', () => {
    expect(extractBearerToken(`Bearer ${VALID}, Bearer ${VALID}`)).toBeNull();
  });

  it('is not confused by leading/trailing whitespace around an otherwise well-formed header', () => {
    expect(extractBearerToken(`  Bearer ${VALID}  `)).toBe(VALID);
  });
});
