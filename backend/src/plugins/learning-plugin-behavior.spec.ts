import path from 'path';

const plugin = require(path.resolve(__dirname, '../../../plugins/wattanam.learning/backend/index.js'));

describe('Learning plugin behavior', () => {
  function activate() {
    const routes = new Map<string, any>();
    const database: any = { query: jest.fn(), execute: jest.fn().mockResolvedValue({ count: 1 }), transaction: jest.fn(async (work: any) => work(database)) };
    const directory = { lookupUsers: jest.fn().mockResolvedValue([{ id:'teacher-1' }]), lookupClasses: jest.fn().mockResolvedValue([{ id:'class-1' }]), classesForUser: jest.fn().mockResolvedValue(['class-1']), getClassRoster: jest.fn().mockResolvedValue({classId:'class-1',className:'Grade 1',students:[{studentId:'student-1',userId:'student-user-1',name:'Ada'}]}) };
    const notifications = { notifyInApp:jest.fn().mockResolvedValue(undefined) };
    plugin.activate({ database, directory, notifications, permissions:{ register:jest.fn() }, navigation:{ register:jest.fn() }, routes:{ register:(definition:any)=>routes.set(`${definition.method} ${definition.path}`,definition) } });
    return { routes, database, directory, notifications };
  }
  it('scopes teacher course discovery to creator or assigned Academic classes', async () => {
    const { routes,database,directory }=activate(); database.query.mockResolvedValueOnce([]);
    await routes.get('GET courses').handler({ principal:{ userId:'teacher-1',role:'TEACHER' } });
    expect(directory.classesForUser).toHaveBeenCalledWith('teacher-1','TEACHER');
    expect(database.query.mock.calls[0][0]).toContain('"academicClassId"=ANY');
    expect(database.query.mock.calls[0][1]).toEqual(['teacher-1',['class-1']]);
  });
  it('validates Academic and directory references before creating a course', async () => {
    const { routes,database,directory }=activate(); database.query.mockResolvedValueOnce([{ id:'course-1',title:'Science',status:'DRAFT',academicClassId:'class-1',createdByDirectoryUserId:'teacher-1' }]);
    const result=await routes.get('POST courses').handler({ principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Science',academicClassId:'class-1'} });
    expect(result.id).toBe('course-1'); expect(directory.lookupClasses).toHaveBeenCalledWith(['class-1']); expect(directory.lookupUsers).toHaveBeenCalledWith(['teacher-1']); expect(database.execute.mock.calls[0][0]).toContain('plugin_wattanam_learning_course');
  });
  it('normalizes and bounds assignment fields before persistence', async () => {
    const { routes,database }=activate(); database.query.mockResolvedValueOnce([{id:'assignment-1',title:'Quiz',status:'PUBLISHED',type:'QUIZ'}]);
    const result=await routes.get('POST assignments').handler({principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Quiz',academicClassId:'class-1',type:'quiz',latePenaltyPct:15,maxAttempts:2,totalMarks:20}});
    expect(result.type).toBe('QUIZ'); expect(database.execute.mock.calls[0][1][6]).toBe('QUIZ'); expect(database.execute.mock.calls[0][1][12]).toBe(15);
  });
  it('rejects impossible assignment windows before writing', async () => {
    const { routes,database }=activate();
    await expect(routes.get('POST assignments').handler({principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Quiz',academicClassId:'class-1',availableFrom:'2026-10-02T00:00:00Z',dueDate:'2026-10-01T00:00:00Z'}})).rejects.toThrow('dueDate must not precede');
    expect(database.execute).not.toHaveBeenCalled();
  });
  it('authors a validated rich quiz question only while an owned assignment is draft', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'assignment-1',status:'DRAFT',createdByDirectoryUserId:'teacher-1'}]);
    const result=await routes.get('POST assignments/:id/questions').handler({params:{id:'assignment-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{questionType:'MCQ_SINGLE',prompt:'2 + 2?',points:2,choices:[{id:'a',text:'Four'},{id:'b',text:'Five'}],correctChoiceId:'a'}});
    expect(result).toMatchObject({assignmentId:'assignment-1',type:'MCQ_SINGLE',prompt:'2 + 2?',points:2});
    expect(database.execute.mock.calls[0][0]).toContain('plugin_wattanam_learning_quiz_question');
  });
  it('starts the next roster-authorized assignment attempt under a transaction lock', async () => {
    const { routes,database,directory }=activate();
    database.query
      .mockResolvedValueOnce([{id:'assignment-1',academicClassId:'class-1',status:'PUBLISHED',allowLate:true,maxAttempts:2}])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{count:1}]);
    const result=await routes.get('POST assignments/:id/submissions/start').handler({params:{id:'assignment-1'},principal:{userId:'student-user-1',role:'STUDENT'}});
    expect(result).toMatchObject({assignmentId:'assignment-1',academicStudentId:'student-1',attemptNumber:2,status:'SUBMITTED'});
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[1][0]).toContain('FOR UPDATE');
    expect(directory.getClassRoster).toHaveBeenCalled();
  });
  it('delivers a quiz without answer keys and auto-grades an owned response', async () => {
    const { routes,database }=activate();
    const question={id:'question-1',assignmentId:'assignment-1',order:0,type:'MCQ_SINGLE',prompt:'2 + 2?',points:2,data:{choices:[{id:'a',text:'Four'},{id:'b',text:'Five'}],correctChoiceId:'a'}};
    database.query
      .mockResolvedValueOnce([{id:'submission-1',assignmentId:'assignment-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'SUBMITTED',academicClassId:'class-1',title:'Math quiz'}])
      .mockResolvedValueOnce([question]);
    const quiz=await routes.get('GET submissions/:id/quiz').handler({params:{id:'submission-1'},principal:{userId:'student-user-1',role:'STUDENT'}});
    expect(quiz.questions[0].correctChoiceId).toBeUndefined();
    expect(JSON.stringify(quiz)).not.toContain('correctChoiceId');
    database.query.mockReset(); database.execute.mockClear();
    database.query
      .mockResolvedValueOnce([{id:'submission-1',assignmentId:'assignment-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'SUBMITTED',academicClassId:'class-1'}])
      .mockResolvedValueOnce([{id:'submission-1',assignmentId:'assignment-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'SUBMITTED'}])
      .mockResolvedValueOnce([question]);
    const saved=await routes.get('POST submissions/:id/answers').handler({params:{id:'submission-1'},principal:{userId:'student-user-1',role:'STUDENT'},body:{questionId:'question-1',response:{choiceId:'a'}}});
    expect(saved).toEqual({submissionId:'submission-1',questionId:'question-1',saved:true,graded:true});
    expect(database.execute.mock.calls[0][1][4]).toBe(2);
  });
  it('applies the configured late penalty when the last manual quiz answer is graded', async () => {
    const { routes,database }=activate();
    database.query
      .mockResolvedValueOnce([{id:'answer-1',submissionId:'submission-1',questionId:'question-1',points:10,createdByDirectoryUserId:'teacher-1',latePenaltyPct:20,dueDate:'2026-09-01T00:00:00.000Z',submittedAt:'2026-09-02T00:00:00.000Z'}])
      .mockResolvedValueOnce([{marks:10,pending:0}]);
    const result=await routes.get('PATCH quiz-answers/:id/grade').handler({params:{id:'answer-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{pointsAwarded:10,feedback:'Good work'}});
    expect(result).toEqual({id:'answer-1',submissionId:'submission-1',pointsAwarded:10,pending:0});
    expect(database.execute).toHaveBeenCalledTimes(2);
    expect(database.execute.mock.calls[1][1]).toEqual(['submission-1',8,20]);
  });
  it('requires at least one lesson before publishing an owned course', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'course-1',title:'Science',academicClassId:'class-1',createdByDirectoryUserId:'teacher-1',status:'DRAFT'}]).mockResolvedValueOnce([]);
    await expect(routes.get('PATCH courses/:id/status').handler({params:{id:'course-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{status:'PUBLISHED'}})).rejects.toThrow('at least one lesson');
    expect(database.execute).not.toHaveBeenCalled();
  });
  it('creates validated lessons only for the course creator before enrollment', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'course-1',title:'Science',academicClassId:'class-1',createdByDirectoryUserId:'teacher-1',status:'DRAFT'}]);
    const result=await routes.get('POST courses/:id/lessons').handler({params:{id:'course-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Introduction',gradingMode:'practice',videoWatchPct:80}});
    expect(result).toMatchObject({courseId:'course-1',title:'Introduction',gradingMode:'PRACTICE',videoWatchPct:80});
    expect(database.execute.mock.calls[0][0]).toContain('plugin_wattanam_learning_lesson');
  });
  it('rejects lesson mutation by a teacher who does not own the course', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'lesson-1',courseId:'course-1',title:'Introduction',status:'DRAFT',createdByDirectoryUserId:'teacher-2',academicClassId:'class-1'}]);
    await expect(routes.get('DELETE lessons/:id').handler({params:{id:'lesson-1'},principal:{userId:'teacher-1',role:'TEACHER'}})).rejects.toThrow('Only the course creator');
    expect(database.execute).not.toHaveBeenCalled();
  });
  it('creates bounded lesson pages for an owned draft lesson', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'lesson-1',courseId:'course-1',title:'Introduction',status:'DRAFT',createdByDirectoryUserId:'teacher-1',academicClassId:'class-1'}]);
    const result=await routes.get('POST lessons/:id/pages').handler({params:{id:'lesson-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Welcome',pageType:'content',content:{body:'Hello'},order:0}});
    expect(result).toMatchObject({lessonId:'lesson-1',title:'Welcome',pageType:'CONTENT',content:{body:'Hello'}});
    expect(database.execute.mock.calls[0][0]).toContain('plugin_wattanam_learning_lesson_page');
  });
  it('rejects cross-lesson branch targets before writing a page', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'lesson-1',courseId:'course-1',title:'Introduction',status:'DRAFT',createdByDirectoryUserId:'teacher-1',academicClassId:'class-1'}]).mockResolvedValueOnce([]);
    await expect(routes.get('POST lessons/:id/pages').handler({params:{id:'lesson-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Branch',pageType:'BRANCH',content:{prompt:'Choose',choices:[{id:'a',text:'A'},{id:'b',text:'B'}]},nextPageId:'page-other'}})).rejects.toThrow('same lesson');
    expect(database.execute).not.toHaveBeenCalled();
  });
  it('enrolls only a current student from the course Academic roster', async () => {
    const { routes,database,directory }=activate();
    database.query.mockResolvedValueOnce([{id:'course-1',academicClassId:'class-1',createdByDirectoryUserId:'teacher-1',status:'ENROLLMENT'}]);
    const result=await routes.get('POST courses/:id/enrollments').handler({params:{id:'course-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{academicStudentId:'student-1'}});
    expect(result).toMatchObject({courseId:'course-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'ENROLLED'});
    expect(directory.getClassRoster).toHaveBeenCalledWith('class-1',expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(database.execute.mock.calls[0][0]).toContain('ON CONFLICT');
  });
  it('discovers student courses through the dated roster contract', async () => {
    const { routes,database,directory }=activate(); database.query.mockResolvedValueOnce([{id:'course-1',title:'Science'}]);
    const result=await routes.get('GET student/courses').handler({principal:{userId:'student-user-1',role:'STUDENT'}});
    expect(result).toEqual([{id:'course-1',title:'Science'}]);
    expect(directory.classesForUser).toHaveBeenCalledWith('student-user-1','STUDENT');
    expect(database.query.mock.calls[0][1]).toEqual(['student-1',['class-1']]);
  });
  it('starts one transaction-locked lesson attempt for an enrolled roster student', async () => {
    const { routes,database }=activate();
    database.query
      .mockResolvedValueOnce([{id:'lesson-1',courseId:'course-1',title:'Introduction',status:'PUBLISHED',courseStatus:'ACTIVE',academicClassId:'class-1',totalPoints:10,maxAttempts:1}])
      .mockResolvedValueOnce([{id:'enrollment-1',courseId:'course-1',academicStudentId:'student-1',status:'ENROLLED',progressPct:0}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{count:0}]);
    const result=await routes.get('POST lessons/:id/attempts/start').handler({params:{id:'lesson-1'},principal:{userId:'student-user-1',role:'STUDENT'}});
    expect(result).toMatchObject({lessonId:'lesson-1',academicStudentId:'student-1',status:'IN_PROGRESS',maxScore:10});
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[1][0]).toContain('FOR UPDATE');
  });
  it('upserts only an owned in-progress attempt response inside a transaction', async () => {
    const { routes,database }=activate();
    database.query
      .mockResolvedValueOnce([{id:'attempt-1',lessonId:'lesson-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'IN_PROGRESS',courseId:'course-1'}])
      .mockResolvedValueOnce([{id:'page-1',lessonId:'lesson-1',pageType:'CONTENT',content:{},order:0,nextPageId:null}]);
    const result=await routes.get('POST attempts/:id/responses').handler({params:{id:'attempt-1'},principal:{userId:'student-user-1',role:'STUDENT'},body:{pageId:'page-1',answer:{viewed:true}}});
    expect(result).toEqual({attemptId:'attempt-1',pageId:'page-1',nextPageId:null,correct:null,pointsAwarded:0,saved:true});
    expect(database.execute.mock.calls[0][0]).toContain('ON CONFLICT');
    expect(database.execute).toHaveBeenCalledTimes(2);
  });
  it('completes a content-only attempt and advances enrollment atomically', async () => {
    const { routes,database }=activate();
    database.query
      .mockResolvedValueOnce([{id:'attempt-1',lessonId:'lesson-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'IN_PROGRESS',courseId:'course-1',gradingMode:'UNGRADED',maxScore:0}])
      .mockResolvedValueOnce([{count:0}]).mockResolvedValueOnce([{count:0,score:0,pending:0}]);
    const result=await routes.get('POST attempts/:id/finish').handler({params:{id:'attempt-1'},principal:{userId:'student-user-1',role:'STUDENT'}});
    expect(result).toEqual({id:'attempt-1',status:'COMPLETED',score:0,maxScore:0,passed:true});
    expect(database.execute).toHaveBeenCalledTimes(2);
  });
  it('redacts Learning answer keys and auto-grades without returning solutions', async () => {
    const { routes,database }=activate();
    const content={questionType:'MCQ_SINGLE',prompt:'2 + 2?',points:2,choices:[{id:'a',text:'Four'},{id:'b',text:'Five'}],correctChoiceId:'a'};
    database.query
      .mockResolvedValueOnce([{id:'lesson-1',courseId:'course-1',title:'Introduction',status:'PUBLISHED',courseStatus:'ACTIVE',academicClassId:'class-1'}])
      .mockResolvedValueOnce([{id:'enrollment-1',status:'ENROLLED'}])
      .mockResolvedValueOnce([{id:'page-1',lessonId:'lesson-1',title:'Question',pageType:'QUESTION',content,order:0,nextPageId:null}]);
    const play=await routes.get('GET lessons/:id/play').handler({params:{id:'lesson-1'},principal:{userId:'student-user-1',role:'STUDENT'}});
    expect(play.pages[0].content.correctChoiceId).toBeUndefined();
    expect(JSON.stringify(play)).not.toContain('correctChoiceId');
    database.query.mockReset(); database.execute.mockClear();
    database.query.mockResolvedValueOnce([{id:'attempt-1',lessonId:'lesson-1',academicStudentId:'student-1',directoryUserId:'student-user-1',status:'IN_PROGRESS',courseId:'course-1'}]).mockResolvedValueOnce([{id:'page-1',lessonId:'lesson-1',pageType:'QUESTION',content,order:0,nextPageId:null}]);
    const result=await routes.get('POST attempts/:id/responses').handler({params:{id:'attempt-1'},principal:{userId:'student-user-1',role:'STUDENT'},body:{pageId:'page-1',answer:{choiceId:'a'}}});
    expect(result).toMatchObject({correct:true,pointsAwarded:2});
  });
  it('manually grades a pending response and completes the attempt atomically', async () => {
    const { routes,database }=activate();
    database.query
      .mockResolvedValueOnce([{id:'response-1',attemptId:'attempt-1',pageId:'page-1',pointsAwarded:null,content:{points:5},pageType:'QUESTION',lessonId:'lesson-1',createdByDirectoryUserId:'teacher-1'}])
      .mockResolvedValueOnce([{score:5,pending:0}])
      .mockResolvedValueOnce([{id:'attempt-1',lessonId:'lesson-1',status:'AWAITING_GRADE',courseId:'course-1',gradingMode:'GRADED',passingScore:4,maxScore:5,createdByDirectoryUserId:'teacher-1'}]);
    const result=await routes.get('PATCH responses/:id/grade').handler({params:{id:'response-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{pointsAwarded:5}});
    expect(result).toEqual({id:'response-1',attemptId:'attempt-1',pointsAwarded:5,attemptStatus:'COMPLETED',score:5,passed:true});
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(database.execute).toHaveBeenCalledTimes(2);
  });
  it('rejects grading by a teacher who does not own the course', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'response-1',attemptId:'attempt-1',pageId:'page-1',pointsAwarded:null,content:{points:5},pageType:'QUESTION',lessonId:'lesson-1',createdByDirectoryUserId:'teacher-2'}]);
    await expect(routes.get('PATCH responses/:id/grade').handler({params:{id:'response-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{pointsAwarded:5}})).rejects.toThrow('Only the course creator');
    expect(database.execute).not.toHaveBeenCalled();
  });
  it('abandons a reset attempt transactionally and notifies only after commit', async () => {
    const { routes,database,notifications }=activate();
    database.query.mockResolvedValueOnce([{id:'attempt-1',lessonId:'lesson-1',directoryUserId:'student-user-1',status:'COMPLETED',lessonTitle:'Essay',courseId:'course-1',createdByDirectoryUserId:'teacher-1'}]);
    const result=await routes.get('PATCH attempts/:id/reset').handler({params:{id:'attempt-1'},principal:{userId:'teacher-1',role:'TEACHER'}});
    expect(result).toEqual({id:'attempt-1',status:'ABANDONED',notified:true});
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(database.execute.mock.calls[0][0]).toContain(`"status"='ABANDONED'`);
    expect(notifications.notifyInApp).toHaveBeenCalledWith('student-user-1','Your attempt on "Essay" was reset. You may start again.','learning_attempt_reset');
    expect(database.transaction.mock.invocationCallOrder[0]).toBeLessThan(notifications.notifyInApp.mock.invocationCallOrder[0]);
  });
  it('records an enrolled learner view and computes video completion without exposing another course', async () => {
    const { routes,database }=activate();
    database.query
      .mockResolvedValueOnce([{id:'lesson-1',courseId:'course-1',requireVideoWatch:true,videoWatchPct:80,academicClassId:'class-1'}])
      .mockResolvedValueOnce([{id:'enrollment-1'}]);
    const result=await routes.get('POST lessons/:id/views').handler({params:{id:'lesson-1'},principal:{userId:'student-user-1',role:'STUDENT'},body:{watchedSeconds:80,videoDurationSec:100}});
    expect(result).toMatchObject({lessonId:'lesson-1',academicStudentId:'student-1',videoCompleted:true});
    expect(database.execute.mock.calls[0][0]).toContain('ON CONFLICT');
  });
  it('creates a bounded course session only for the course owner', async () => {
    const { routes,database }=activate();
    database.query.mockResolvedValueOnce([{id:'course-1',academicClassId:'class-1',createdByDirectoryUserId:'teacher-1',status:'ACTIVE'}]);
    const result=await routes.get('POST courses/:id/sessions').handler({params:{id:'course-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{title:'Lab',scheduledAt:'2026-10-01T02:00:00Z',durationMinutes:45,location:'Room 2'}});
    expect(result).toMatchObject({courseId:'course-1',title:'Lab',durationMinutes:45,location:'Room 2'});
    expect(database.execute.mock.calls[0][0]).toContain('plugin_wattanam_learning_course_session');
  });
  it('upserts course-session attendance only for a current roster student', async () => {
    const { routes,database,directory }=activate();
    database.query.mockResolvedValueOnce([{id:'session-1',courseId:'course-1',academicClassId:'class-1',createdByDirectoryUserId:'teacher-1'}]);
    const result=await routes.get('PUT sessions/:id/attendance').handler({params:{id:'session-1'},principal:{userId:'teacher-1',role:'TEACHER'},body:{academicStudentId:'student-1',status:'late',source:'manual'}});
    expect(result).toEqual({sessionId:'session-1',academicStudentId:'student-1',status:'LATE',source:'MANUAL'});
    expect(directory.getClassRoster).toHaveBeenCalled();
    expect(database.execute.mock.calls[0][0]).toContain('ON CONFLICT');
  });
});
