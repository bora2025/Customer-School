import { Inject, Injectable } from '@nestjs/common';
import { ACADEMIC_STUDY_YEARS_PROVIDER, AcademicStudyYearsProvider, StudyYearCreateInput, StudyYearUpdateInput } from './academic-study-years.contract';

@Injectable()
export class StudyYearsService {
  constructor(@Inject(ACADEMIC_STUDY_YEARS_PROVIDER) private readonly academic: AcademicStudyYearsProvider) {}

  getAll() { return this.academic.getAll(); }
  getCurrent() { return this.academic.getCurrent(); }
  create(data: StudyYearCreateInput) { return this.academic.create(data); }
  update(id: string, data: StudyYearUpdateInput) { return this.academic.update(id, data); }
  setCurrent(id: string) { return this.academic.setCurrent({ id, idempotencyKey: `set-current-study-year:${id}` }); }
  delete(id: string) { return this.academic.delete(id); }
}
