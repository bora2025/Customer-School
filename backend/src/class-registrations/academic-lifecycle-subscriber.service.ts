import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PluginEventBus } from '../plugins/plugin-events';

type VersionedEventPayload<T> = T & { principal?: { userId: string } | null };

interface StudyYearCreatedPayload extends VersionedEventPayload<unknown> {
  studyYear: { id: string; year: number; label?: string | null; isCurrent: boolean };
}

interface StudyYearUpdatedPayload extends VersionedEventPayload<unknown> {
  studyYear: { id: string; year: number; label?: string | null; isCurrent: boolean };
}

interface StudyYearSetCurrentPayload extends VersionedEventPayload<unknown> {
  studyYear: { id: string; year: number; label?: string | null; isCurrent: boolean };
}

interface StudyYearDeletedPayload extends VersionedEventPayload<unknown> {
  studyYearId: string;
}

interface ClassCreatedPayload extends VersionedEventPayload<unknown> {
  class: { id: string; name: string; studyYearId?: string | null; teacherId: string; classAdminId?: string | null };
}

interface ClassUpdatedPayload extends VersionedEventPayload<unknown> {
  class: { id: string; name: string; studyYearId?: string | null; teacherId: string; classAdminId?: string | null };
}

interface ClassDeletedPayload extends VersionedEventPayload<unknown> {
  classId: string;
}

interface StudentAddedToClassPayload extends VersionedEventPayload<unknown> {
  student: { id: string; userId: string; studentNumber?: string | null; classId?: string | null };
  classId: string;
}

interface StudentUpdatedPayload extends VersionedEventPayload<unknown> {
  student: { id: string; userId: string; studentNumber?: string | null; classId?: string | null };
}

interface StudentRemovedFromClassPayload extends VersionedEventPayload<unknown> {
  studentId: string;
  classId: string;
}

interface StudentsCleanedUpPayload extends VersionedEventPayload<unknown> {
  studentIds: string[];
  deleted: number;
}

/**
 * Core-side listener for Academic Management lifecycle events.
 *
 * Currently logs each event for audit/troubleshooting. In later slices this is the seam where
 * dependent core modules (Timetable, Attendance, Exam, Fees, etc.) react without coupling to the
 * plugin schema.
 */
@Injectable()
export class AcademicLifecycleSubscriber implements OnModuleInit {
  private readonly logger = new Logger(AcademicLifecycleSubscriber.name);

  constructor(private readonly eventBus: PluginEventBus) {}

  onModuleInit() {
    this.eventBus.subscribe<StudyYearCreatedPayload>('academic.study-year.created.v1', (p) => this.log('study-year.created', p));
    this.eventBus.subscribe<StudyYearUpdatedPayload>('academic.study-year.updated.v1', (p) => this.log('study-year.updated', p));
    this.eventBus.subscribe<StudyYearSetCurrentPayload>('academic.study-year.set-current.v1', (p) => this.log('study-year.set-current', p));
    this.eventBus.subscribe<StudyYearDeletedPayload>('academic.study-year.deleted.v1', (p) => this.log('study-year.deleted', p));
    this.eventBus.subscribe<ClassCreatedPayload>('academic.class.created.v1', (p) => this.log('class.created', p));
    this.eventBus.subscribe<ClassUpdatedPayload>('academic.class.updated.v1', (p) => this.log('class.updated', p));
    this.eventBus.subscribe<ClassDeletedPayload>('academic.class.deleted.v1', (p) => this.log('class.deleted', p));
    this.eventBus.subscribe<StudentAddedToClassPayload>('academic.student.added-to-class.v1', (p) => this.log('student.added-to-class', p));
    this.eventBus.subscribe<StudentUpdatedPayload>('academic.student.updated.v1', (p) => this.log('student.updated', p));
    this.eventBus.subscribe<StudentRemovedFromClassPayload>('academic.student.removed-from-class.v1', (p) => this.log('student.removed-from-class', p));
    this.eventBus.subscribe<StudentsCleanedUpPayload>('academic.students.cleaned-up.v1', (p) => this.log('students.cleaned-up', p));
  }

  private log(name: string, payload: VersionedEventPayload<unknown>) {
    const actor = payload.principal?.userId ?? 'system';
    this.logger.log(`academic.${name}.v1 actor=${actor}`);
  }
}
