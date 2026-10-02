import { Inject, Injectable } from '@nestjs/common';
import {
  ACADEMIC_DEPARTMENTS_PROVIDER,
  AcademicDepartmentsProvider,
  DepartmentCreateInput,
  DepartmentUpdateInput,
} from './academic-departments.contract';

@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(ACADEMIC_DEPARTMENTS_PROVIDER)
    private readonly academic: AcademicDepartmentsProvider,
  ) {}

  async findAll() {
    return this.academic.findAll();
  }

  async create(data: DepartmentCreateInput) {
    return this.academic.create(data);
  }

  async update(id: string, data: DepartmentUpdateInput) {
    return this.academic.update(id, data);
  }

  async delete(id: string) {
    return this.academic.delete({ id, idempotencyKey: `delete-department:${id}` });
  }
}
