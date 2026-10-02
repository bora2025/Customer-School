export const ACADEMIC_STUDY_YEARS_PROVIDER = Symbol('ACADEMIC_STUDY_YEARS_PROVIDER');

export type StudyYearCreateInput = {
  year: number; label?: string; startDate?: string; endDate?: string; schoolName?: string; logoUrl?: string;
};
export type StudyYearUpdateInput = {
  year?: number; label?: string; startDate?: string; endDate?: string; schoolName?: string; logoUrl?: string | null;
};

export interface AcademicStudyYearsProvider {
  getAll(): Promise<unknown>;
  getCurrent(): Promise<unknown>;
  create(data: StudyYearCreateInput): Promise<unknown>;
  update(id: string, data: StudyYearUpdateInput): Promise<unknown>;
  setCurrent(input: { id: string; idempotencyKey: string }): Promise<unknown>;
  delete(id: string): Promise<unknown>;
}
