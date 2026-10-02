import { matchesAnyToken, readMetricsTokens } from './metrics-config';

describe('readMetricsTokens', () => {
  it('returns an empty list when unset, so /metrics is disabled by default', () => {
    expect(readMetricsTokens({})).toEqual([]);
  });

  it('rejects a token shorter than 32 characters', () => {
    expect(() => readMetricsTokens({ METRICS_TOKEN: 'too-short' })).toThrow('at least 32 characters');
  });

  it('accepts and trims a valid token', () => {
    const token = 'a'.repeat(32);
    expect(readMetricsTokens({ METRICS_TOKEN: `  ${token}  ` })).toEqual([token]);
  });

  it('includes still-trusted secondary tokens during a rotation overlap window', () => {
    const primary = 'a'.repeat(32);
    const secondary = 'b'.repeat(32);
    expect(readMetricsTokens({ METRICS_TOKEN: primary, METRICS_SECONDARY_TOKENS_JSON: JSON.stringify([secondary]) }))
      .toEqual([primary, secondary]);
  });

  it('rejects malformed or wrongly-shaped METRICS_SECONDARY_TOKENS_JSON', () => {
    const primary = 'a'.repeat(32);
    expect(() => readMetricsTokens({ METRICS_TOKEN: primary, METRICS_SECONDARY_TOKENS_JSON: 'not json' })).toThrow('must be valid JSON');
    expect(() => readMetricsTokens({ METRICS_TOKEN: primary, METRICS_SECONDARY_TOKENS_JSON: '"not an array"' })).toThrow('must be a JSON array');
    expect(() => readMetricsTokens({ METRICS_TOKEN: primary, METRICS_SECONDARY_TOKENS_JSON: '["too-short"]' })).toThrow('must be a JSON array');
  });
});

describe('matchesAnyToken', () => {
  const tokens = ['a'.repeat(32), 'b'.repeat(32)];

  it('accepts a bearer header matching any listed token', () => {
    expect(matchesAnyToken(`Bearer ${tokens[0]}`, tokens)).toBe(true);
    expect(matchesAnyToken(`Bearer ${tokens[1]}`, tokens)).toBe(true);
  });

  it('rejects a token that is not in the list', () => {
    expect(matchesAnyToken(`Bearer ${'c'.repeat(32)}`, tokens)).toBe(false);
  });

  it('rejects a missing or malformed authorization header', () => {
    expect(matchesAnyToken('', tokens)).toBe(false);
    expect(matchesAnyToken(tokens[0], tokens)).toBe(false);
  });
});
