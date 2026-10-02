import { SEED_SECTION_REGISTRY, seedSectionsForDistribution } from './seed-composition';

describe('seed composition', () => {
  it('selects only the generic identity fixture for core', () => {
    expect(seedSectionsForDistribution('core')).toEqual(['core-identity']);

    const selected = SEED_SECTION_REGISTRY.filter((section) =>
      seedSectionsForDistribution('core').includes(section.name),
    );
    expect(selected.every((section) => section.classification === 'core')).toBe(true);
    expect(selected.flatMap((section) => section.models)).toEqual(['User']);
  });

  it('preserves all existing development fixtures for legacy-full', () => {
    expect(seedSectionsForDistribution('legacy-full')).toEqual([
      'core-identity',
      'legacy-business-demo',
    ]);
    expect(SEED_SECTION_REGISTRY.find((section) => section.name === 'legacy-business-demo')?.models)
      .toEqual(['Department', 'User', 'Class', 'Student']);
  });
});

