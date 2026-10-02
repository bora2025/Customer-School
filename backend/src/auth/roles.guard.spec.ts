import { roleSatisfies } from './roles.guard';

describe('roleSatisfies', () => {
  it('matches a role directly against the required list', () => {
    expect(roleSatisfies('CLASS_ADMIN', ['CLASS_ADMIN'])).toBe(true);
    expect(roleSatisfies('WATTAMAN_REPORTER', ['CLASS_ADMIN'])).toBe(false);
  });

  it('lets a higher role satisfy a requirement it inherits', () => {
    expect(roleSatisfies('SUPER_ADMIN', ['CLASS_ADMIN'])).toBe(true);
    expect(roleSatisfies('SCHOOL_ADMIN', ['ACCOUNTER'])).toBe(true);
    expect(roleSatisfies('ADMIN', ['WATTAMAN_REPORTER'])).toBe(true);
  });

  it('does not let a lower role satisfy a requirement only a higher role inherits', () => {
    expect(roleSatisfies('CLASS_ADMIN', ['ADMIN'])).toBe(false);
    expect(roleSatisfies('WATTAMAN', ['SCHOOL_ADMIN'])).toBe(false);
  });

  it('fails closed for a missing role or an empty requirement list', () => {
    expect(roleSatisfies(undefined, ['CLASS_ADMIN'])).toBe(false);
    expect(roleSatisfies('SUPER_ADMIN', [])).toBe(false);
  });
});
