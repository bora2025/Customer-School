export const ACADEMIC_ROSTER_CONTRACT_ID = 'wattanam.academic-management.roster';
export const ACADEMIC_ROSTER_CONTRACT_VERSION = '1.0.0';

export type AcademicRosterStudent = {
  studentId: string;
  userId: string;
  studentNumber: string | null;
  name: string;
  parentId: string | null;
};

export type AcademicClassRoster = {
  contract: { id: typeof ACADEMIC_ROSTER_CONTRACT_ID; version: typeof ACADEMIC_ROSTER_CONTRACT_VERSION };
  classId: string;
  className: string | null;
  asOfIsoDate: string;
  source: 'legacy-current-membership' | 'plugin-enrollment-interval';
  students: AcademicRosterStudent[];
};

export type AcademicEnrollment = {
  contract: { id: typeof ACADEMIC_ROSTER_CONTRACT_ID; version: typeof ACADEMIC_ROSTER_CONTRACT_VERSION };
  studentId: string;
  classId: string | null;
  className: string | null;
  enrolled: boolean;
  asOfIsoDate: string;
  source: 'legacy-current-membership' | 'plugin-enrollment-interval';
};

export function currentAcademicDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error('asOfIsoDate must be a valid ISO date (YYYY-MM-DD)');
  }
  return value;
}

export function parseAcademicClassRoster(value: unknown): AcademicClassRoster {
  const roster = value as Partial<AcademicClassRoster> | null;
  if (!roster || roster.contract?.id !== ACADEMIC_ROSTER_CONTRACT_ID || roster.contract.version !== ACADEMIC_ROSTER_CONTRACT_VERSION) {
    throw new Error('Academic roster contract identity is invalid');
  }
  currentAcademicDate(String(roster.asOfIsoDate));
  if (typeof roster.classId !== 'string' || !Array.isArray(roster.students) || !['legacy-current-membership', 'plugin-enrollment-interval'].includes(String(roster.source))) {
    throw new Error('Academic roster contract payload is invalid');
  }
  for (const student of roster.students) {
    if (!student || typeof student.studentId !== 'string' || typeof student.userId !== 'string' || typeof student.name !== 'string') {
      throw new Error('Academic roster student payload is invalid');
    }
  }
  return roster as AcademicClassRoster;
}

export function parseAcademicEnrollment(value: unknown): AcademicEnrollment {
  const enrollment = value as Partial<AcademicEnrollment> | null;
  if (!enrollment || enrollment.contract?.id !== ACADEMIC_ROSTER_CONTRACT_ID || enrollment.contract.version !== ACADEMIC_ROSTER_CONTRACT_VERSION) {
    throw new Error('Academic enrollment contract identity is invalid');
  }
  currentAcademicDate(String(enrollment.asOfIsoDate));
  if (typeof enrollment.studentId !== 'string' || typeof enrollment.enrolled !== 'boolean' || !['legacy-current-membership', 'plugin-enrollment-interval'].includes(String(enrollment.source))) {
    throw new Error('Academic enrollment contract payload is invalid');
  }
  if (enrollment.classId !== null && typeof enrollment.classId !== 'string') throw new Error('Academic enrollment classId is invalid');
  if (enrollment.enrolled !== Boolean(enrollment.classId)) throw new Error('Academic enrollment state is inconsistent');
  return enrollment as AcademicEnrollment;
}
