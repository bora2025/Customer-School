import path from 'path';

const plugin = require(path.resolve(__dirname, '../../../plugins/wattanam.examination/backend/index.js'));
const examinationQuestions = require(path.resolve(__dirname, '../../../plugins/wattanam.examination/backend/attempts.js'));

describe('Examination plugin behavior', () => {
  function activate(overrides: any = {}) {
    const routes = new Map<string, any>();
    const database: any = {
      query: jest.fn(), execute: jest.fn().mockResolvedValue({ count: 1 }),
      transaction: jest.fn(async (work: any) => work(database)),
      ...overrides.database,
    };
    const directory = {
      lookupUsers: jest.fn().mockResolvedValue([{ id: 'teacher-1' }]),
      lookupClasses: jest.fn().mockResolvedValue([{ id: 'class-1' }]),
      lookupSubjects: jest.fn().mockResolvedValue([{ id: 'subject-1', name: 'Mathematics', code: 'MATH' }]),
      classesForUser: jest.fn().mockResolvedValue(['class-1']),
      getClassRoster: jest.fn().mockResolvedValue({ students: [{ studentId: 'student-1', userId: 'student-user-1' }] }),
      ...overrides.directory,
    };
    const readModels = { publish: jest.fn().mockResolvedValue(undefined), ...overrides.readModels };
    plugin.activate({
      database, directory,
      readModels,
      notifications: { notifyInApp: jest.fn().mockResolvedValue({ id: 'notification-1' }) },
      permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (definition: any) => routes.set(`${definition.method} ${definition.path}`, definition) },
    });
    return { routes, database, directory, readModels };
  }

  it('creates an exam and its validated questions atomically', async () => {
    const { routes, database, directory } = activate();
    database.query.mockResolvedValueOnce([{ id: 'new-exam', status: 'DRAFT' }]);
    const result = await routes.get('POST exams').handler({
      principal: { userId: 'teacher-1', role: 'TEACHER' },
      body: { title: 'Final', academicClassId: 'class-1', questions: [{ text: '2 + 2?', type: 'MCQ', data: { choices: [{ id: 'a', text: 'Four', isCorrect: true }, { id: 'b', text: 'Five', isCorrect: false }] }, marks: 2 }] },
    });
    expect(result.status).toBe('DRAFT');
    expect(directory.lookupUsers).toHaveBeenCalledWith(['teacher-1']);
    expect(directory.lookupClasses).toHaveBeenCalledWith(['class-1']);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.execute).toHaveBeenCalledTimes(2);
  });

  it('rejects mutation by a teacher who did not create the exam', async () => {
    const { routes, database } = activate();
    database.query.mockResolvedValueOnce([{ id: 'exam-1', status: 'DRAFT', createdByDirectoryUserId: 'teacher-2' }]);
    await expect(routes.get('DELETE exams/:id').handler({ params: { id: 'exam-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } }))
      .rejects.toThrow('Only the exam creator');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('requires a question before publishing and enforces lifecycle transitions', async () => {
    const { routes, database } = activate();
    database.query.mockResolvedValueOnce([{ id: 'exam-1', status: 'DRAFT', createdByDirectoryUserId: 'teacher-1' }]).mockResolvedValueOnce([]);
    await expect(routes.get('PATCH exams/:id/status').handler({ params: { id: 'exam-1' }, body: { status: 'PUBLISHED' }, principal: { userId: 'teacher-1', role: 'TEACHER' } }))
      .rejects.toThrow('at least one question');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('scopes teacher discovery to creator and assigned Academic classes', async () => {
    const { routes, database, directory } = activate(); database.query.mockResolvedValueOnce([]);
    await routes.get('GET exams').handler({ principal: { userId: 'teacher-1', role: 'TEACHER' } });
    expect(directory.classesForUser).toHaveBeenCalledWith('teacher-1', 'TEACHER');
    expect(database.query.mock.calls[0][0]).toContain('"academicClassId" = ANY');
    expect(database.query.mock.calls[0][1]).toEqual(['teacher-1', ['class-1']]);
  });

  it('serves a roster-authorized student projection without answer keys', async () => {
    const { routes, database } = activate();
    database.query
      .mockResolvedValueOnce([{ id: 'exam-1', academicClassId: 'class-1', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ id: 'question-1', type: 'MCQ', text: 'Answer', marks: 2, order: 0, section: null, data: { choices: [{ id: 'a', text: 'Four', isCorrect: true }] } }]);
    const result = await routes.get('GET exams/:id/take').handler({ params: { id: 'exam-1' }, principal: { userId: 'student-user-1', role: 'STUDENT' } });
    expect(result.questions[0].data.choices).toEqual([{ id: 'a', text: 'Four' }]);
    expect(JSON.stringify(result)).not.toContain('isCorrect');
  });

  it('submits and automatically grades an owned attempt in one transaction', async () => {
    const { routes, database, readModels } = activate();
    database.query
      .mockResolvedValueOnce([{ id: 'attempt-1', examId: 'exam-1', academicStudentId: 'student-1', status: 'IN_PROGRESS', passMark: 1, answers: null }])
      .mockResolvedValueOnce([{ id: 'question-1', type: 'MCQ', marks: 2, data: { choices: [{ id: 'a', isCorrect: true }] } }])
      .mockResolvedValue([]);
    const result = await routes.get('POST attempts/:id/submit').handler({
      params: { id: 'attempt-1' }, principal: { userId: 'student-user-1', role: 'STUDENT' }, body: { answers: { 'question-1': 'a' } },
    });
    expect(result).toMatchObject({ status: 'GRADED', score: 2, grade: 'PASS' });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.execute.mock.calls[0][0]).toContain('"attemptNumber"="attemptNumber"+1');
    expect(readModels.publish).toHaveBeenCalledWith('student-grade-summary', 1, 'student-1', expect.objectContaining({
      studentId: 'student-1', gradebooks: [], attempts: [],
    }));
    expect(JSON.stringify(readModels.publish.mock.calls[0][3])).not.toMatch(/answer|question|formula|feedback|manualMarks/);
  });

  it('redacts answer material for every rich question type', () => {
    const fixtures: any[] = [
      ['SORT_PARAGRAPHS', { paragraphs: [{ id: 'p1', text: 'First' }, { id: 'p2', text: 'Second' }] }],
      ['DRAG_WORDS', { text: 'A *secret* word', distractors: ['other'] }],
      ['FILL_BLANKS', { text: 'A *secret/answer* word' }],
      ['DRAG_DROP', { backgroundImage: '/image.png', zones: [{ id: 'z1', x: 0, y: 0, width: 10, height: 10 }], items: [{ id: 'i1', label: 'Item', correctZoneId: 'z1' }] }],
      ['SPEAK_WORDS', { prompt: 'Say it', acceptedAnswers: ['secret'] }],
      ['SPEAK_WORDS_SET', { items: [{ id: 's1', prompt: 'Say it', acceptedAnswers: ['secret'] }] }],
    ];
    for (const [type, data] of fixtures) {
      const safe = examinationQuestions.safeQuestion({ id: 'q1', text: 'Prompt', type, marks: 2, order: 0, section: null, data });
      expect(JSON.stringify(safe)).not.toMatch(/correctZoneId|acceptedAnswers|\*secret|secret\/answer/);
    }
  });

  it('matches legacy rich-question grading including partial credit and manual essays', () => {
    expect(examinationQuestions.gradeQuestion({ type: 'SORT_PARAGRAPHS', marks: 4, data: { paragraphs: [{ id: 'a' }, { id: 'b' }] } }, ['a', 'wrong'])).toEqual({ automatic: true, marks: 2 });
    expect(examinationQuestions.gradeQuestion({ type: 'FILL_BLANKS', marks: 4, data: { text: '*Blue/azure* and *Red*' } }, { fb0: 'azure', fb1: 'wrong' })).toEqual({ automatic: true, marks: 2 });
    expect(examinationQuestions.gradeQuestion({ type: 'ESSAY', marks: 5, data: { minWords: 10 } }, 'response')).toEqual({ automatic: false, marks: 0 });
  });

  it('lets the creator reset an attempt and notifies its directory user', async () => {
    const routes = new Map<string, any>();
    const database: any = { query: jest.fn().mockResolvedValue([{ id: 'attempt-1', title: 'Final', createdByDirectoryUserId: 'teacher-1', directoryUserId: 'student-user-1' }]), execute: jest.fn().mockResolvedValue({ count: 1 }), transaction: jest.fn() };
    const notifications = { notifyInApp: jest.fn().mockResolvedValue({ id: 'notice-1' }) };
    plugin.activate({ database, directory: { lookupUsers: jest.fn(), lookupClasses: jest.fn(), classesForUser: jest.fn(), getClassRoster: jest.fn() }, notifications, readModels: { publish: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() }, routes: { register: (definition: any) => routes.set(`${definition.method} ${definition.path}`, definition) } });
    const result = await routes.get('DELETE attempts/:id/reset').handler({ params: { id: 'attempt-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } });
    expect(result).toEqual({ reset: true, id: 'attempt-1', notified: true });
    expect(database.execute).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM'), ['attempt-1']);
    expect(notifications.notifyInApp).toHaveBeenCalledWith('student-user-1', expect.stringContaining('Final'), 'exam_reset');
  });

  it('creates a gradebook and its validated class bindings atomically', async () => {
    const { routes, database, directory } = activate();
    directory.lookupClasses.mockResolvedValueOnce([{ id: 'class-1' }, { id: 'class-2' }]);
    database.query.mockResolvedValueOnce([{ id: 'sheet-1', name: '2026 Gradebook' }]);
    const result = await routes.get('POST gradebooks').handler({
      principal: { userId: 'teacher-1', role: 'TEACHER' },
      body: { name: '2026 Gradebook', classIds: ['class-1', 'class-2'] },
    });
    expect(result.name).toBe('2026 Gradebook');
    expect(directory.lookupClasses).toHaveBeenCalledWith(['class-1', 'class-2']);
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.execute).toHaveBeenCalledTimes(3);
  });

  it('rejects non-canonical subject references and accepts Academic contract matches', async () => {
    const { routes, database, directory } = activate();
    database.query
      .mockResolvedValueOnce([{ id: 'sheet-1', createdByDirectoryUserId: 'teacher-1' }])
      .mockResolvedValueOnce([{ id: 'local-subject-1', name: 'Mathematics', academicSubjectId: 'subject-1' }]);
    const result = await routes.get('POST gradebooks/:id/subjects').handler({
      params: { id: 'sheet-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' },
      body: { name: 'Mathematics', academicSubjectId: 'subject-1', maxScore: 100 },
    });
    expect(result.academicSubjectId).toBe('subject-1');
    expect(directory.lookupSubjects).toHaveBeenCalledWith(['subject-1']);
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects direct gradebook reads outside creator and assigned-class scope', async () => {
    const { routes, database, directory } = activate();
    database.query
      .mockResolvedValueOnce([{ id: 'sheet-1', createdByDirectoryUserId: 'teacher-2' }])
      .mockResolvedValueOnce([{ academicClassId: 'class-2' }]);
    directory.classesForUser.mockResolvedValueOnce(['class-1']);
    await expect(routes.get('GET gradebooks/:id').handler({ params: { id: 'sheet-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } }))
      .rejects.toThrow('outside your assigned classes');
  });

  it('builds a bounded report from dated rosters and namespaced score data', async () => {
    const { routes, database, directory } = activate();
    database.query
      .mockResolvedValueOnce([{ id: 'sheet-1', name: 'Gradebook', createdByDirectoryUserId: 'teacher-1' }])
      .mockResolvedValueOnce([{ academicClassId: 'class-1' }])
      .mockResolvedValueOnce([{ id: 'subject-1', name: 'Math' }])
      .mockResolvedValueOnce([{ id: 'tab-1', label: 'Semester 1' }])
      .mockResolvedValueOnce([{ id: 'entry-1', academicStudentId: 'student-1', subjectId: 'subject-1', scoreTabId: 'tab-1', score: 90 }]);
    directory.getClassRoster.mockResolvedValueOnce({ className: 'Grade 1', students: [{ studentId: 'student-1', userId: 'student-user-1', name: 'Ada' }] });
    const report = await routes.get('GET gradebooks/:id/report').handler({ params: { id: 'sheet-1' }, principal: { userId: 'teacher-1', role: 'TEACHER' } });
    expect(report.students).toEqual([{ studentId: 'student-1', userId: 'student-user-1', name: 'Ada', classId: 'class-1', className: 'Grade 1' }]);
    expect(report.entries).toHaveLength(1);
    expect(report.reportRows).toEqual([{ id: 'entry-1', studentId: 'student-1', studentName: 'Ada', className: 'Grade 1', period: 'Semester 1', subject: 'Math', score: 90, maximumScore: null, formula: null }]);
  });
});
