import { CspViolationAggregator, summarizeCspReports } from './csp-report';

describe('CSP report summaries', () => {
  it('reads the legacy report-uri format', () => {
    const [violation] = summarizeCspReports({ 'csp-report': {
      'document-uri': 'https://school.example/admin/students?token=secret-reset-token',
      'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js?exfil=1', disposition: 'report',
    } });
    expect(violation).toEqual({ directive: 'script-src-elem', blocked: 'https://evil.example', page: '/admin/students', disposition: 'report' });
  });

  it('reads the Reporting API format and ignores other report types', () => {
    const violations = summarizeCspReports([
      { type: 'csp-violation', body: { documentURL: 'https://school.example/login', effectiveDirective: 'script-src-elem', blockedURL: 'inline', disposition: 'report' } },
      { type: 'deprecation', body: { id: 'x' } },
    ]);
    expect(violations).toEqual([{ directive: 'script-src-elem', blocked: 'inline', page: '/login', disposition: 'report' }]);
  });

  it('never keeps query strings, full URLs or line breaks', () => {
    const [violation] = summarizeCspReports({ 'csp-report': {
      'document-uri': 'https://school.example/a?b=c#d', 'effective-directive': 'img-src\nFAKE LOG LINE', 'blocked-uri': 'data:image/png;base64,AAAA',
    } });
    expect(violation.page).toBe('/a');
    expect(violation.blocked).toBe('data');
    expect(violation.directive).toBe('img-src');
    expect(JSON.stringify(violation)).not.toMatch(/\n|b=c|base64/);
  });

  it('caps the number of reports taken from one request and rejects junk', () => {
    const many = Array.from({ length: 100 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.example/a.png', documentURL: 'https://s.example/' } }));
    expect(summarizeCspReports(many)).toHaveLength(20);
    expect(summarizeCspReports('not json')).toEqual([]);
    expect(summarizeCspReports({ other: 1 })).toEqual([]);
    expect(summarizeCspReports(null)).toEqual([]);
  });

  it('logs each distinct violation once per window, then reports the suppressed count', () => {
    const aggregator = new CspViolationAggregator(1000);
    const violation = { directive: 'script-src-elem', blocked: 'inline', page: '/login', disposition: 'report' };
    expect(aggregator.record(violation, 0)).toEqual({ log: true, count: 1 });
    expect(aggregator.record(violation, 100).log).toBe(false);
    expect(aggregator.record(violation, 200).log).toBe(false);
    expect(aggregator.record(violation, 1500)).toEqual({ log: true, count: 3 });
    expect(aggregator.record({ ...violation, page: '/admin' }, 1600).log).toBe(true);
  });

  it('bounds memory when attackers vary the key', () => {
    const aggregator = new CspViolationAggregator(60_000, 10);
    for (let index = 0; index < 50; index += 1) aggregator.record({ directive: 'img-src', blocked: `https://h${index}.example`, page: '/', disposition: 'report' }, index);
    expect((aggregator as any).seen.size).toBe(10);
  });
});
