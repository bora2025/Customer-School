export const ACADEMIC_DEPARTMENTS_PROVIDER = 'ACADEMIC_DEPARTMENTS_PROVIDER';

export type DepartmentCreateInput = { name: string; nameKh?: string; description?: string };
export type DepartmentUpdateInput = { name?: string; nameKh?: string; description?: string };

export interface AcademicDepartmentsProvider {
  findAll(): Promise<unknown[]>;
  create(data: DepartmentCreateInput): Promise<unknown>;
  update(id: string, data: DepartmentUpdateInput): Promise<unknown>;
  delete(input: { id: string; idempotencyKey: string }): Promise<unknown>;
}
