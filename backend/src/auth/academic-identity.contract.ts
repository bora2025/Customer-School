export const ACADEMIC_IDENTITY_PROVIDER = 'ACADEMIC_IDENTITY_PROVIDER';

export interface AcademicIdentityProvider {
  attachAcademicProfiles(users: Array<Record<string, any>>): Promise<Array<Record<string, any>>>;
  assignStudentParent(input: {
    studentUserId: string;
    parentId: string | null;
    idempotencyKey: string;
  }): Promise<void>;
  assignUserDepartment(input: {
    userId: string;
    departmentId: string | null;
    idempotencyKey: string;
  }): Promise<void>;
  detachUserAcademicIdentity(input: {
    userId: string;
    idempotencyKey: string;
  }): Promise<void>;
}
