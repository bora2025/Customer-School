'use strict';

// Read-only gate. A passing report is evidence for a controlled drill, not permission to switch
// production routing: other Academic Management consumers still use legacy academic storage.
const fs = require('node:fs');
const path = require('node:path');
const { inspect, TARGET_TABLES } = require('./academic-management-adoption-preflight');
const { journalPaths } = require('./academic-management-adopt');
const { inspect: inspectStudyYears, TARGET_TABLE: STUDY_YEAR_TARGET_TABLE } = require('./academic-study-years-adoption-preflight');
const { journalPath: studyYearJournalPath } = require('./academic-study-years-adopt');
const { inspect: inspectClasses, TARGET_TABLE: CLASS_TARGET_TABLE } = require('./academic-classes-adoption-preflight');
const { journalPath: classJournalPath } = require('./academic-classes-adopt');
const { inspect: inspectAdmissions, TARGET_TABLES: ADMISSIONS_TARGET_TABLES } = require('./academic-admissions-adoption-preflight');
const { journalPath: admissionsJournalPath } = require('./academic-admissions-adopt');
const { inspect: inspectStudentProfiles, TARGET_TABLE: STUDENT_PROFILE_TARGET_TABLE } = require('./academic-student-profiles-adoption-preflight');
const { journalPath: studentProfileJournalPath } = require('./academic-student-profiles-adopt');
const { inspect: inspectEnrollment, TARGET_TABLE: ENROLLMENT_TARGET_TABLE, journalPath: enrollmentJournalPath } = require('./academic-enrollment-adopt');
const { inspect: inspectSubjects, TARGET_TABLE: SUBJECT_TARGET_TABLE } = require('./academic-subjects-adoption-preflight');
const { journalPath: subjectJournalPath } = require('./academic-subjects-adopt');
const { verifyRecoveryBackup } = require('./document-designer-adopt');
const { loadJournal } = require('./plugin-adoption-toolkit');
const { inspectOwnership } = require('./academic-management-ownership-readiness');

async function check({ adapter, directory, backupName, slug, ownership = null }) {
  const backup = verifyRecoveryBackup(directory, backupName, slug);
  const files = journalPaths(directory, slug);
  const studyYearJournal = studyYearJournalPath(directory, slug);
  const classJournal = classJournalPath(directory, slug);
  const admissionsJournal = admissionsJournalPath(directory, slug);
  const studentProfileJournal = studentProfileJournalPath(directory, slug);
  const enrollmentJournal = enrollmentJournalPath(directory, slug);
  const subjectJournal = subjectJournalPath(directory, slug);
  const source = await inspect(adapter);
  const sourceStudyYears = await inspectStudyYears({
    readStudyYearChunk: adapter.readStudyYearChunk,
    targetState: adapter.studyYearTargetState,
  });
  const sourceClasses = await inspectClasses({
    readClassChunk: adapter.readClassChunk,
    targetState: adapter.classTargetState,
  });
  const sourceAdmissions = await inspectAdmissions({
    readRegistrationChunk: adapter.readRegistrationChunk,
    readSettingsSingleton: adapter.readSettingsSingleton,
    readFieldChunk: adapter.readFieldChunk,
    targetState: adapter.admissionsTargetState,
  });
  const sourceStudentProfiles = await inspectStudentProfiles({
    readStudentChunk: adapter.readStudentChunk,
    targetState: adapter.studentProfileTargetState,
  });
  const sourceEnrollment = await inspectEnrollment({ readAllSource: adapter.readEnrollmentSource, targetState: adapter.enrollmentTargetState });
  const sourceSubjects = await inspectSubjects({
    readClassSubjectChunk: adapter.readClassSubjectChunk,
    targetState: adapter.subjectTargetState,
  });
  const blockers = source.blockers.filter((item) => !item.endsWith('is not empty'));
  blockers.push(...sourceStudyYears.blockers.filter((item) => !item.endsWith('is not empty')));
  blockers.push(...sourceClasses.blockers.filter((item) => !item.endsWith('is not empty')));
  blockers.push(...sourceAdmissions.blockers.filter((item) => !item.endsWith('is not empty')));
  blockers.push(...sourceStudentProfiles.blockers.filter((item) => !item.endsWith('is not empty')));
  blockers.push(...sourceEnrollment.blockers.filter((item) => !item.endsWith('is not empty')));
  blockers.push(...sourceSubjects.blockers.filter((item) => !item.endsWith('is not empty')));
  const targetsExist = source.target.tables.every((table) => table.exists);
  const studyYearTargetExists = sourceStudyYears.target.exists;
  const classTargetExists = sourceClasses.target.exists;
  const admissionsTargetsExist = sourceAdmissions.target.every((table) => table.exists);
  const studentProfileTargetExists = sourceStudentProfiles.target.exists;
  const enrollmentTargetExists = sourceEnrollment.target.exists;
  const subjectTargetExists = sourceSubjects.target.exists;
  const target = targetsExist ? await inspect({
    readDepartmentChunk: adapter.readTargetDepartmentChunk,
    readMembershipChunk: adapter.readTargetMembershipChunk,
    targetState: async () => TARGET_TABLES.map((table) => ({ table, exists: true, rowCount: 0 })),
  }) : null;
  const targetStudyYears = studyYearTargetExists ? await inspectStudyYears({
    readStudyYearChunk: adapter.readTargetStudyYearChunk,
    targetState: async () => ({ table: STUDY_YEAR_TARGET_TABLE, exists: true, rowCount: 0 }),
  }) : null;
  const targetClasses = classTargetExists ? await inspectClasses({
    readClassChunk: adapter.readTargetClassChunk,
    targetState: async () => ({ table: CLASS_TARGET_TABLE, exists: true, rowCount: 0 }),
  }) : null;
  const targetAdmissions = admissionsTargetsExist ? await inspectAdmissions({
    readRegistrationChunk: adapter.readTargetRegistrationChunk,
    readSettingsSingleton: adapter.readTargetSettingsSingleton,
    readFieldChunk: adapter.readTargetFieldChunk,
    targetState: async (table) => ({ table, exists: true, rowCount: 0 }),
  }) : null;
  const targetStudentProfiles = studentProfileTargetExists ? await inspectStudentProfiles({
    readStudentChunk: adapter.readTargetStudentProfileChunk,
    targetState: async () => ({ table: STUDENT_PROFILE_TARGET_TABLE, exists: true, rowCount: 0 }),
  }) : null;
  const targetEnrollment = enrollmentTargetExists ? {
    source: {
      intervalCount: (await adapter.readTargetEnrollment()).length,
      sha256: require('./academic-enrollment-adopt').fingerprint((await adapter.readTargetEnrollment()).sort((a, b) => a.id.localeCompare(b.id))),
    },
  } : null;
  const targetSubjects = subjectTargetExists ? await inspectSubjects({
    readClassSubjectChunk: adapter.readTargetSubjectChunk,
    targetState: async () => ({ table: SUBJECT_TARGET_TABLE, exists: true, rowCount: 0 }),
  }) : null;
  if (target) {
    blockers.push(...target.blockers);
    if (source.source.departmentCount !== target.source.departmentCount ||
        source.source.membershipCount !== target.source.membershipCount ||
        source.source.sha256 !== target.source.sha256) blockers.push('academic source and target fingerprints/counts differ');
  }
  if (targetStudyYears) {
    blockers.push(...targetStudyYears.blockers);
    if (sourceStudyYears.source.studyYearCount !== targetStudyYears.source.studyYearCount ||
        sourceStudyYears.source.currentCount !== targetStudyYears.source.currentCount ||
        sourceStudyYears.source.sha256 !== targetStudyYears.source.sha256) {
      blockers.push('academic study-year source and target fingerprints/counts differ');
    }
  }
  if (targetClasses) {
    blockers.push(...targetClasses.blockers);
    if (sourceClasses.source.classCount !== targetClasses.source.classCount ||
        sourceClasses.source.sha256 !== targetClasses.source.sha256) {
      blockers.push('academic class source and target fingerprints/counts differ');
    }
  }
  if (targetAdmissions) {
    blockers.push(...targetAdmissions.blockers);
    if (sourceAdmissions.source.registrationCount !== targetAdmissions.source.registrationCount ||
        sourceAdmissions.source.fieldCount !== targetAdmissions.source.fieldCount ||
        sourceAdmissions.source.settingsPresent !== targetAdmissions.source.settingsPresent ||
        sourceAdmissions.source.sha256 !== targetAdmissions.source.sha256) {
      blockers.push('academic admissions source and target fingerprints/counts differ');
    }
  }
  if (targetStudentProfiles) {
    blockers.push(...targetStudentProfiles.blockers);
    if (sourceStudentProfiles.source.studentProfileCount !== targetStudentProfiles.source.studentProfileCount ||
        sourceStudentProfiles.source.sha256 !== targetStudentProfiles.source.sha256) {
      blockers.push('academic Student profile source and target fingerprints/counts differ');
    }
  }
  if (targetEnrollment && (sourceEnrollment.source.intervalCount !== targetEnrollment.source.intervalCount || sourceEnrollment.source.sha256 !== targetEnrollment.source.sha256)) {
    blockers.push('academic enrollment source and target fingerprints/counts differ');
  }
  if (targetSubjects) {
    blockers.push(...targetSubjects.blockers);
    if (sourceSubjects.source.subjectCount !== targetSubjects.source.subjectCount ||
        sourceSubjects.source.sha256 !== targetSubjects.source.sha256) {
      blockers.push('academic subject source and target fingerprints/counts differ');
    }
  }
  const identity = `academic:${slug}:${source.source.sha256}:${backup.sha256}`;
  const studyYearIdentity = `attendance-study-years:${slug}:${sourceStudyYears.source.sha256}:${backup.sha256}`;
  const classIdentity = `academic-classes:${slug}:${sourceClasses.source.sha256}:${backup.sha256}`;
  const admissionsIdentity = `academic-admissions:${slug}:${sourceAdmissions.source.sha256}:${backup.sha256}`;
  const studentProfileIdentity = `academic-student-profiles:${slug}:${sourceStudentProfiles.source.sha256}:${backup.sha256}`;
  const enrollmentIdentity = `academic-enrollment:${slug}:${sourceEnrollment.source.sha256}:${backup.sha256}`;
  const subjectIdentity = `academic-subjects:${slug}:${sourceSubjects.source.sha256}:${backup.sha256}`;
  const journalStages = {};
  for (const [phase, file] of [['departments', files.departments], ['memberships', files.memberships]]) {
    if (!fs.existsSync(file)) { blockers.push(`${phase} adoption journal is absent`); continue; }
    try {
      const journal = loadJournal(file, `${identity}:${phase}`);
      journalStages[phase] = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') {
        blockers.push(`${phase} journal is not reconciled against the verified backup`);
      }
    } catch { blockers.push(`${phase} adoption journal identity is invalid`); }
  }
  if (!fs.existsSync(studyYearJournal)) {
    blockers.push('study-years adoption journal is absent');
  } else {
    try {
      const journal = loadJournal(studyYearJournal, studyYearIdentity);
      journalStages.studyYears = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') {
        blockers.push('study-years journal is not reconciled against the verified backup');
      }
    } catch {
      blockers.push('study-years adoption journal identity is invalid');
    }
  }
  if (!fs.existsSync(classJournal)) {
    blockers.push('classes adoption journal is absent');
  } else {
    try {
      const journal = loadJournal(classJournal, classIdentity);
      journalStages.classes = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') {
        blockers.push('classes journal is not reconciled against the verified backup');
      }
    } catch {
      blockers.push('classes adoption journal identity is invalid');
    }
  }
  if (!fs.existsSync(admissionsJournal)) {
    blockers.push('admissions adoption journal is absent');
  } else {
    try {
      const journal = loadJournal(admissionsJournal, admissionsIdentity);
      journalStages.admissions = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') {
        blockers.push('admissions journal is not reconciled against the verified backup');
      }
    } catch {
      blockers.push('admissions adoption journal identity is invalid');
    }
  }
  if (!fs.existsSync(studentProfileJournal)) {
    blockers.push('student-profiles adoption journal is absent');
  } else {
    try {
      const journal = loadJournal(studentProfileJournal, studentProfileIdentity);
      journalStages.studentProfiles = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') {
        blockers.push('student-profiles journal is not reconciled against the verified backup');
      }
    } catch {
      blockers.push('student-profiles adoption journal identity is invalid');
    }
  }
  if (!fs.existsSync(enrollmentJournal)) {
    blockers.push('enrollment adoption journal is absent');
  } else {
    try {
      const journal = loadJournal(enrollmentJournal, enrollmentIdentity);
      journalStages.enrollment = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') blockers.push('enrollment journal is not reconciled against the verified backup');
    } catch { blockers.push('enrollment adoption journal identity is invalid'); }
  }
  if (!fs.existsSync(subjectJournal)) {
    blockers.push('subjects adoption journal is absent');
  } else {
    try {
      const journal = loadJournal(subjectJournal, subjectIdentity);
      journalStages.subjects = journal.stage;
      if (journal.backupSha256 !== backup.sha256 || journal.stage !== 'reconciled') blockers.push('subjects journal is not reconciled against the verified backup');
    } catch { blockers.push('subjects adoption journal identity is invalid'); }
  }
  const installation = await adapter.pluginState();
  if (installation?.status !== 'active') blockers.push('Academic Management plugin is not active');
  const studyYearInstallation = await adapter.studyYearPluginState();
  if (studyYearInstallation?.status !== 'active') blockers.push('Attendance Manager plugin is not active for Study Year ownership');
  if (fs.existsSync(files.maintenance)) blockers.push('plugin adoption maintenance lock is still present');
  if (ownership && !ownership.ready) {
    blockers.push(...ownership.blockers.map((blocker) => `ownership: ${blocker}`));
  }
  return {
    format: 'wattanam-academic-management-cutover-readiness-v1', readOnly: true,
    ready: blockers.length === 0, blockers, schoolSlug: slug,
    source: { departments: source.source, studyYears: sourceStudyYears.source, classes: sourceClasses.source, admissions: sourceAdmissions.source, studentProfiles: sourceStudentProfiles.source, enrollment: sourceEnrollment.source, subjects: sourceSubjects.source },
    target: { departments: target?.source ?? null, studyYears: targetStudyYears?.source ?? null, classes: targetClasses?.source ?? null, admissions: targetAdmissions?.source ?? null, studentProfiles: targetStudentProfiles?.source ?? null, enrollment: targetEnrollment?.source ?? null, subjects: targetSubjects?.source ?? null },
    backup: { file: path.basename(backup.archive), sha256: backup.sha256 },
    journals: journalStages,
    plugin: { status: installation?.status ?? 'absent', version: installation?.version ?? null },
    studyYearPlugin: { status: studyYearInstallation?.status ?? 'absent', version: studyYearInstallation?.version ?? null },
    ownership,
    warning: 'Passing parity does not certify full Academic Management extraction, dual-write consistency, or production cutover',
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const directory = process.env.BACKUP_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('absolute BACKUP_DIR is required');
  const slug = process.env.ACADEMIC_SCHOOL_SLUG;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || slug.length > 80) throw new Error('ACADEMIC_SCHOOL_SLUG is invalid');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const departmentTable = TARGET_TABLES[0];
  const membershipTable = TARGET_TABLES[1];
  const studyYearTable = STUDY_YEAR_TARGET_TABLE;
  const classTable = CLASS_TARGET_TABLE;
  const [registrationTable, settingsTable, fieldTable] = ADMISSIONS_TARGET_TABLES;
  const studentProfileTable = STUDENT_PROFILE_TARGET_TABLE;
  const enrollmentTable = ENROLLMENT_TARGET_TABLE;
  const subjectTable = SUBJECT_TARGET_TABLE;
  const studyYearSelect = {
    id: true,
    year: true,
    label: true,
    startDate: true,
    endDate: true,
    isCurrent: true,
    schoolName: true,
    logoUrl: true,
  };
  const registrationSelect = {
    id: true,
    classId: true,
    nameKh: true,
    nameEn: true,
    email: true,
    phone: true,
    passwordHash: true,
    generatedPassword: true,
    photo: true,
    sex: true,
    dateOfBirth: true,
    address: true,
    generation: true,
    customFieldValues: true,
    status: true,
    rejectReason: true,
    studentId: true,
    createdAt: true,
    resolvedAt: true,
    resolvedBy: true,
  };
  const fieldSelect = {
    id: true,
    key: true,
    label: true,
    fieldType: true,
    options: true,
    required: true,
    order: true,
    enabled: true,
    createdAt: true,
    updatedAt: true,
  };
  const settingsSelect = {
    id: true,
    khmerNameMode: true,
    phoneMode: true,
    emailMode: true,
    photoMode: true,
    passwordMode: true,
    sexMode: true,
    dateOfBirthMode: true,
    addressMode: true,
    generationMode: true,
    updatedAt: true,
  };
  const adapter = {
    readDepartmentChunk: ({ after, limit }) => prisma.department.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, name: true, nameKh: true, description: true } }),
    readMembershipChunk: ({ after, limit }) => prisma.user.findMany({ where: { departmentId: { not: null } }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, departmentId: true } }).then((rows) => rows.map((row) => ({ userId: row.id, departmentId: row.departmentId }))),
    readStudyYearChunk: ({ after, limit }) => prisma.studyYear.findMany({ ...(after !== null ? { where: { year: { gt: after } } } : {}), orderBy: { year: 'asc' }, take: limit, select: studyYearSelect }),
    readClassChunk: ({ after, limit }) => prisma.class.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, name: true, subject: true, teacherId: true, classAdminId: true, studyYearId: true, schedule: true, registrationStatus: true, thumbnail: true, description: true, price: true, showPrice: true, createdAt: true, updatedAt: true } }),
    readRegistrationChunk: ({ after, limit }) => prisma.classRegistration.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: registrationSelect }),
    readSettingsSingleton: () => prisma.classRegistrationSettings.findUnique({ where: { id: 'singleton' }, select: settingsSelect }),
    readFieldChunk: ({ after, limit }) => prisma.classRegistrationField.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: fieldSelect }),
    readStudentChunk: ({ after, limit }) => prisma.student.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, userId: true, studentNumber: true, parentId: true, qrCode: true, photo: true, sex: true, dateOfBirth: true, address: true, generation: true, nameKh: true, customFieldValues: true, createdAt: true, updatedAt: true } }),
    readEnrollmentSource: () => prisma.student.findMany({ where: { classId: { not: null } }, orderBy: { id: 'asc' }, select: { id: true, classId: true, createdAt: true } }).then((rows) => rows.map((row) => ({ studentId: row.id, classId: row.classId, createdAt: row.createdAt }))),
    readClassSubjectChunk: ({ after, limit }) => prisma.class.findMany({ ...(after ? { cursor: { id: after }, skip: 1 } : {}), orderBy: { id: 'asc' }, take: limit, select: { id: true, subject: true } }),
    readTargetDepartmentChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","name","nameKh","description" FROM "${departmentTable}" WHERE "id" > $1 ORDER BY "id" LIMIT $2`, after || '', limit),
    readTargetMembershipChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "userId","departmentId" FROM "${membershipTable}" WHERE "userId" > $1 ORDER BY "userId" LIMIT $2`, after || '', limit),
    readTargetStudyYearChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","year","label","startDate","endDate","isCurrent","schoolName","logoUrl" FROM "${studyYearTable}" WHERE "year" > $1 ORDER BY "year" ASC LIMIT $2`, after ?? Number.MIN_SAFE_INTEGER, limit),
    readTargetClassChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","name","subject","teacherId","classAdminId","studyYearId","schedule","registrationStatus","thumbnail","description","price","showPrice","createdAt","updatedAt" FROM "${classTable}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after || '', limit),
    readTargetRegistrationChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","classId","nameKh","nameEn","email","phone","passwordHash","generatedPassword","photo","sex","dateOfBirth","address","generation","customFieldValues","status","rejectReason","studentId","createdAt","resolvedAt","resolvedBy" FROM "${registrationTable}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after || '', limit),
    readTargetSettingsSingleton: () => prisma.$queryRawUnsafe(`SELECT "id","khmerNameMode","phoneMode","emailMode","photoMode","passwordMode","sexMode","dateOfBirthMode","addressMode","generationMode","updatedAt" FROM "${settingsTable}" WHERE "id" = 'singleton' LIMIT 1`).then((rows) => rows[0] ?? null),
    readTargetFieldChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","key","label","fieldType","options","required","order","enabled","createdAt","updatedAt" FROM "${fieldTable}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after || '', limit),
    readTargetStudentProfileChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id","userId","studentNumber","guardianUserId" AS "parentId","qrCode","photo","sex","dateOfBirth","address","generation","nameKh","customFieldValues","createdAt","updatedAt" FROM "${studentProfileTable}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after || '', limit),
    readTargetEnrollment: () => prisma.$queryRawUnsafe(`SELECT "id","studentId","classId",to_char("validFrom",'YYYY-MM-DD') AS "validFrom",CASE WHEN "validTo" IS NULL THEN NULL ELSE to_char("validTo",'YYYY-MM-DD') END AS "validTo","source" FROM "${enrollmentTable}" ORDER BY "id"`),
    readTargetSubjectChunk: ({ after, limit }) => prisma.$queryRawUnsafe(`SELECT "id", "name" AS "subject" FROM "${subjectTable}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`, after || '', limit),
    targetState: async (tables) => Promise.all(tables.map(async (table) => { const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`); const exists = found[0]?.exists === true; const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : []; return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 }; })),
    studyYearTargetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
    },
    classTargetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
    },
    admissionsTargetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
    },
    studentProfileTargetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
    },
    enrollmentTargetState: async () => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${enrollmentTable}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${enrollmentTable}"`) : [];
      return { table: enrollmentTable, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
    },
    subjectTargetState: async (table) => {
      const found = await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS "exists"`);
      const exists = found[0]?.exists === true;
      const counts = exists ? await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "${table}"`) : [];
      return { table, exists, rowCount: exists ? Number(counts[0]?.count || 0) : 0 };
    },
    pluginState: () => prisma.pluginInstallation.findUnique({ where: { id: 'wattanam.academic-management' }, select: { status: true, version: true } }),
    studyYearPluginState: () => prisma.pluginInstallation.findUnique({ where: { id: 'wattanam.attendance-manager' }, select: { status: true, version: true } }),
  };
  try {
    const expectedOwner = String(process.env.ACADEMIC_EXPECTED_OWNER ?? 'legacy').trim().toLowerCase();
    const ownership = inspectOwnership(process.env, expectedOwner);
    const report = await check({ adapter, directory, backupName: process.env.ACADEMIC_BACKUP_FILE, slug, ownership });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 2;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`Academic cutover check failed: ${error.message}\n`); process.exitCode = 1; });
module.exports = { check };
