import type { Distribution } from '../config/environment';

export type SeedSectionName = 'core-identity' | 'legacy-business-demo';

export interface SeedSectionRegistration {
  name: SeedSectionName;
  classification: 'core' | 'business';
  models: readonly string[];
}

/**
 * Reviewed ownership boundary for development seed records. Keeping the model targets here makes
 * it possible to prove that a core installation cannot receive school-domain demo data.
 */
export const SEED_SECTION_REGISTRY: readonly SeedSectionRegistration[] = [
  { name: 'core-identity', classification: 'core', models: ['User'] },
  {
    name: 'legacy-business-demo',
    classification: 'business',
    models: ['Department', 'User', 'Class', 'Student'],
  },
] as const;

export function seedSectionsForDistribution(distribution: Distribution): SeedSectionName[] {
  return SEED_SECTION_REGISTRY
    .filter((section) => distribution === 'legacy-full' || section.classification === 'core')
    .map((section) => section.name);
}

