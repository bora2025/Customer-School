import fs from 'fs';
import path from 'path';

const pluginRoot = path.resolve(__dirname, '../../../plugins/wattanam.attendance-manager');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require(path.join(pluginRoot, 'backend/index.js'));

describe('Attendance Manager production database contract', () => {
  it('uses query only for SELECT and execute only for mutations', async () => {
    const routes: any[] = [];
    const queries: string[] = [];
    const mutations: string[] = [];
    const mutationParams: unknown[][] = [];
    const publishReadModel = jest.fn().mockResolvedValue(undefined);
    const publishDurable = jest.fn().mockResolvedValue(undefined);
    const publishTransient = jest.fn();
    const select = async (sql: string) => {
      expect(sql.trim()).toMatch(/^SELECT\b/i);
      queries.push(sql);
      if (sql.includes('plugin_wattanam_attendance_manager_identifier') && sql.includes('"code"=$1')) {
        return [{ personId: 'student-1', personType: 'STUDENT' }];
      }
      return [{ id: 'record-1', year: 2026, personId: 'student-1', personType: 'STUDENT' }];
    };
    const execute = async (sql: string, params: unknown[] = []) => {
      expect(sql.trim()).toMatch(/^(INSERT|UPDATE|DELETE)\b/i);
      expect(sql).not.toMatch(/\bRETURNING\b/i);
      mutations.push(sql);
      mutationParams.push(params);
      return { count: 1 };
    };
    const context: any = {
      logger: { log: jest.fn() },
      permissions: { register: jest.fn() },
      navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } },
      events: { publish: publishTransient },
      readModels: { publish: publishReadModel, read: jest.fn() },
      directory: { classesForUser: jest.fn().mockResolvedValue(['class-1']), getClassRoster: jest.fn().mockResolvedValue({
        contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
        classId: 'class-1', className: 'Grade 1A', asOfIsoDate: '2026-09-23', source: 'plugin-enrollment-interval',
        students: [{ studentId: 'student-1', userId: 'user-1', studentNumber: 'S001', name: 'Student One', parentId: null }],
      }) },
      database: {
        query: select,
        execute,
        transaction: async (work: any) => work({ query: select, execute, publish: publishDurable }),
      },
    };
    await plugin.activate(context);
    const route = (method: string, routePath: string) => routes.find((candidate) => candidate.method === method && candidate.path === routePath);
    const principal = { userId: 'admin-1', role: 'ADMIN' };

    expect(route('POST', 'records').permission).toBe('wattanam.attendance-manager.mark');
    expect(route('GET', 'records/:id').permission).toBe('wattanam.attendance-manager.view');
    expect(route('POST', 'scan').permission).toBe('wattanam.attendance-manager.scan');
    expect(route('GET', 'reports/summary').permission).toBe('wattanam.attendance-manager.report');
    expect(route('GET', 'reports/daily-grid').permission).toBe('wattanam.attendance-manager.report');
    expect(route('GET', 'reports/student-detail').permission).toBe('wattanam.attendance-manager.report');
    expect(route('GET', 'reports/monthly-trend').permission).toBe('wattanam.attendance-manager.report');
    expect(route('GET', 'reports/class-progress').permission).toBe('wattanam.attendance-manager.report');
    expect(route('GET', 'reports/print-data').permission).toBe('wattanam.attendance-manager.print');
    expect(route('GET', 'reports/export-csv').permission).toBe('wattanam.attendance-manager.print');
    expect(route('PATCH', 'records/:id/correct').permission).toBe('wattanam.attendance-manager.correct');
    expect(route('POST', 'study-years').permission).toBe('wattanam.attendance-manager.configure');
    expect(route('POST', 'identifiers').permission).toBe('wattanam.attendance-manager.devices.manage');

    await route('POST', 'records').handler({ principal, body: { personId: 'student-1', personType: 'STUDENT', classId: 'class-1', date: '2026-09-23', session: 1 } });
    await route('POST', 'study-years').handler({ principal, body: { year: 2026 } });
    await route('PUT', 'study-years/:id').handler({ principal, params: { id: 'year-1' }, body: { label: '2026-2027' } });
    await route('POST', 'study-years/:id/set-current').handler({ principal, params: { id: 'year-1' }, body: {} });
    await route('DELETE', 'study-years/:id').handler({ principal, params: { id: 'year-1' }, body: {} });
    await route('POST', 'identifiers').handler({ principal, body: { code: 'QR-1', personId: 'student-1', personType: 'STUDENT' } });
    await route('POST', 'sessions').handler({ principal, body: { scope: 'STUDENT', session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '08:00' } });
    await route('POST', 'holidays').handler({ principal, body: { date: '2026-09-24', name: 'Constitution Day' } });

    expect(mutations.length).toBeGreaterThanOrEqual(7);
    expect(queries.length).toBeGreaterThanOrEqual(6);
    expect(publishReadModel).toHaveBeenCalledWith('study-year', 1, expect.any(String), expect.any(Object));
    expect(publishReadModel).toHaveBeenCalledWith('student-attendance-summary', 1, 'student-1', expect.objectContaining({
      studentId: 'student-1', counts: expect.any(Object), recent: expect.any(Array),
    }));
    const attendanceProjection = publishReadModel.mock.calls.find(([name]) => name === 'student-attendance-summary')?.[3];
    expect(JSON.stringify(attendanceProjection)).not.toMatch(/scanLatitude|scanLongitude|scanLocation|markedById|permissionType|personNumber/);
    expect(publishDurable).toHaveBeenCalledTimes(5);
    expect(publishDurable).toHaveBeenCalledWith(expect.objectContaining({ event: 'wattanam.attendance-manager.attendance.recorded', version: 1 }));
    expect(publishDurable).toHaveBeenCalledWith(expect.objectContaining({
      event: 'wattanam.attendance-manager.study-year.created', version: 1,
      subjectKey: expect.any(String), idempotencyKey: expect.stringMatching(/^study-year-created-[a-f0-9]{64}$/),
    }));
    expect(publishDurable).toHaveBeenCalledWith(expect.objectContaining({ event: 'wattanam.attendance-manager.study-year.updated' }));
    expect(publishDurable).toHaveBeenCalledWith(expect.objectContaining({ event: 'wattanam.attendance-manager.study-year.set-current' }));
    expect(publishDurable).toHaveBeenCalledWith(expect.objectContaining({ event: 'wattanam.attendance-manager.study-year.deleted' }));
    expect(publishTransient).toHaveBeenCalledWith('attendance.study-year.created.v1', expect.any(Object));
    expect(publishTransient).toHaveBeenCalledWith('attendance.study-year.deleted.v1', expect.any(Object));
    expect(mutationParams[0]).toEqual(expect.arrayContaining(['Student One', 'S001', 'Grade 1A']));
  });

  it('contains no write statement sent through database.query', () => {
    const source = fs.readFileSync(path.join(pluginRoot, 'backend/index.js'), 'utf8');
    expect(source).not.toMatch(/database\.query\(\s*`\s*(?:INSERT|UPDATE|DELETE)\b/i);
  });

  it('enforces the ADR-0019 student-only boundary', async () => {
    const routes: any[] = [];
    const context: any = {
      logger: { log: jest.fn() },
      permissions: { register: jest.fn() },
      navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } },
      events: { publish: jest.fn() },
      readModels: { publish: jest.fn(), read: jest.fn() },
      directory: { getClassRoster: jest.fn() },
      database: {
        query: jest.fn().mockResolvedValue([]),
        execute: jest.fn(),
        transaction: jest.fn(),
      },
    };
    await plugin.activate(context);
    const route = (method: string, routePath: string) => routes.find((candidate) => candidate.method === method && candidate.path === routePath);
    const principal = { userId: 'admin-1', role: 'ADMIN' };

    await expect(route('POST', 'records').handler({ principal, body: { personId: 'staff-1', personType: 'STAFF' } }))
      .rejects.toThrow('personType is invalid');
    await expect(route('POST', 'identifiers').handler({ principal, body: { code: 'STAFF-1', personId: 'staff-1', personType: 'STAFF' } }))
      .rejects.toThrow('personType is invalid');
    await expect(route('POST', 'sessions').handler({ principal, body: { scope: 'TEACHER', session: 1, type: 'CHECK_IN', startTime: '07:00', endTime: '08:00' } }))
      .rejects.toThrow('scope is invalid');
    await expect(route('GET', 'records').handler({ query: { personType: 'STAFF' } }))
      .rejects.toThrow('personType is invalid');
  });

  it('declares the complete MP3 data foundation in additive migrations', () => {
    const migration = fs.readFileSync(path.join(pluginRoot, 'migrations/004_add_corrections_scans_alerts_snapshots.sql'), 'utf8');
    expect(migration).toContain('-- wattanam-plugin-migration: 004_add_corrections_scans_alerts_snapshots');
    expect(migration).toContain('plugin_wattanam_attendance_manager_correction');
    expect(migration).toContain('plugin_wattanam_attendance_manager_scan');
    expect(migration).toContain('"idempotencyKey" TEXT NOT NULL UNIQUE');
    expect(migration).toContain('"codeHash" TEXT NOT NULL');
    const scanTable = migration.match(/CREATE TABLE IF NOT EXISTS "plugin_wattanam_attendance_manager_scan" \([\s\S]*?\n\);/)?.[0] || '';
    expect(scanTable).not.toContain('"code" TEXT');
    expect(migration).toContain('plugin_wattanam_attendance_manager_alert_rule');
    expect(migration).toContain('plugin_wattanam_attendance_manager_alert');
    for (const field of ['personNameSnapshot', 'personNumberSnapshot', 'classNameSnapshot', 'studyYearLabelSnapshot']) {
      expect(migration).toContain(`"${field}" TEXT`);
    }
  });

  it('fails closed when Academic says the student is not enrolled on the attendance date', async () => {
    const routes: any[] = [];
    const execute = jest.fn();
    const context: any = {
      logger: { log: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } },
      events: { publish: jest.fn() }, readModels: { publish: jest.fn(), read: jest.fn() },
      directory: { classesForUser: jest.fn().mockResolvedValue(['class-1']), getClassRoster: jest.fn().mockResolvedValue({
        contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
        classId: 'class-1', className: 'Grade 1A', asOfIsoDate: '2026-09-25',
        source: 'plugin-enrollment-interval', students: [],
      }) },
      database: { query: jest.fn().mockResolvedValue([]), execute, transaction: jest.fn() },
    };
    await plugin.activate(context);
    const record = routes.find((candidate) => candidate.method === 'POST' && candidate.path === 'records');
    await expect(record.handler({
      principal: { userId: 'teacher-1', role: 'TEACHER' },
      body: { personId: 'student-1', classId: 'class-1', date: '2026-09-25', session: 1 },
    })).rejects.toThrow('Student is not enrolled in this class on the attendance date');
    expect(execute).not.toHaveBeenCalled();
  });

  it('serializes scanner retries and returns the original record without a second mutation or event', async () => {
    const routes: any[] = [];
    let acceptedScan: { recordId: string; outcome: string; errorCode: null } | null = null;
    let isHoliday = false;
    const record = { id: 'record-1', personId: 'student-1', personType: 'STUDENT', classId: 'class-1', date: '2026-09-25', session: 1, status: 'PRESENT' };
    const recordWrites = jest.fn();
    const scanWrites = jest.fn();
    const durable = jest.fn();
    const transient = jest.fn();
    const query = async (sql: string) => {
      if (sql.includes(`FROM ${'plugin_wattanam_attendance_manager_identifier'}`)) return [{ personId: 'student-1', personType: 'STUDENT' }];
      if (sql.includes('plugin_wattanam_attendance_manager_session')) return [{ session: 1, startTime: '00:00', endTime: '23:59', classId: 'class-1' }];
      if (sql.includes('plugin_wattanam_attendance_manager_holiday') && sql.includes('WHERE "date"')) return isHoliday ? [{ id: 'holiday-1' }] : [];
      if (sql.includes('"isCurrent"=TRUE')) return [{ id: 'year-1', label: '2026-2027', year: 2026 }];
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: true }];
      if (sql.includes('plugin_wattanam_attendance_manager_scan') && sql.includes('"idempotencyKey"')) return acceptedScan ? [acceptedScan] : [];
      if (sql.includes('plugin_wattanam_attendance_manager_record')) return [record];
      return [];
    };
    const execute = async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT INTO plugin_wattanam_attendance_manager_record')) recordWrites();
      if (sql.startsWith('INSERT INTO plugin_wattanam_attendance_manager_scan')) {
        scanWrites(); acceptedScan = { recordId: String(params[7]), outcome: 'ACCEPTED', errorCode: null };
      }
      return { count: 1 };
    };
    const context: any = {
      logger: { log: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } }, events: { publish: transient },
      readModels: { publish: jest.fn(), read: jest.fn() },
      settings: { get: jest.fn(async (_key: string, fallback: unknown) => fallback) },
      directory: { classesForUser: jest.fn().mockResolvedValue(['class-1']), getClassRoster: jest.fn().mockResolvedValue({
        contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
        classId: 'class-1', className: 'Grade 1A', asOfIsoDate: '2026-09-25', source: 'plugin-enrollment-interval',
        students: [{ studentId: 'student-1', userId: 'user-1', studentNumber: 'S001', name: 'Student One', parentId: null }],
      }) },
      database: { query, execute, transaction: async (work: any) => work({ query, execute, publish: durable }) },
    };
    await plugin.activate(context);
    const scan = routes.find((candidate) => candidate.method === 'POST' && candidate.path === 'scan');
    const request = () => ({ principal: { userId: 'teacher-1', role: 'TEACHER' }, body: { code: 'QR-1', classId: 'class-1', date: '2026-09-25', session: 1, idempotencyKey: 'device-1:scan-0001' } });

    await expect(scan.handler({ ...request(), principal: { userId: 'student-user', role: 'STUDENT' } })).rejects.toThrow('This role cannot scan student attendance');
    await expect(scan.handler({ ...request(), body: { ...request().body, idempotencyKey: 'device-1:scan-old1', clientTimestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() } })).rejects.toThrow('Offline attendance scan is too old');
    await expect(scan.handler({ ...request(), body: { ...request().body, idempotencyKey: 'device-1:scan-future1', clientTimestamp: new Date(Date.now() + 10 * 60 * 1000).toISOString() } })).rejects.toThrow('Scanner clock is too far in the future');
    await expect(scan.handler({ ...request(), body: { ...request().body, idempotencyKey: 'device-1:scan-session2', session: 2 } })).rejects.toThrow('No active attendance session');
    isHoliday = true;
    await expect(scan.handler({ ...request(), body: { ...request().body, idempotencyKey: 'device-1:scan-holiday1' } })).rejects.toThrow('Attendance cannot be scanned on a configured holiday');
    isHoliday = false;
    await expect(scan.handler(request())).resolves.toEqual(expect.objectContaining({ id: 'record-1', idempotentReplay: false }));
    await expect(scan.handler(request())).resolves.toEqual(expect.objectContaining({ id: 'record-1', idempotentReplay: true }));
    expect(recordWrites).toHaveBeenCalledTimes(1);
    expect(scanWrites).toHaveBeenCalledTimes(1);
    expect(durable).toHaveBeenCalledTimes(1);
    expect(transient).toHaveBeenCalledTimes(1);
  });

  it('corrects a student record with immutable before/after history and a durable event', async () => {
    const routes: any[] = [];
    const mutations: Array<{ sql: string; params: unknown[] }> = [];
    const durable = jest.fn(); const transient = jest.fn();
    const previous = { id: 'record-1', personType: 'STUDENT', status: 'ABSENT', permissionType: null };
    const corrected = { ...previous, status: 'PERMISSION', permissionType: 'MEDICAL' };
    let updated = false;
    const query = async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return [previous];
      if (sql.includes('plugin_wattanam_attendance_manager_record') && sql.includes('LIMIT 1')) return [updated ? corrected : previous];
      return [];
    };
    const execute = async (sql: string, params: unknown[] = []) => {
      mutations.push({ sql, params }); if (sql.startsWith('UPDATE')) updated = true; return { count: 1 };
    };
    const context: any = {
      logger: { log: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } }, events: { publish: transient },
      readModels: { publish: jest.fn(), read: jest.fn() },
      database: { query, execute, transaction: async (work: any) => work({ query, execute, publish: durable }) },
    };
    await plugin.activate(context);
    const correction = routes.find((candidate) => candidate.method === 'PATCH' && candidate.path === 'records/:id/correct');
    await expect(correction.handler({
      principal: { userId: 'admin-1', role: 'ADMIN' }, params: { id: 'record-1' },
      body: { status: 'PERMISSION', permissionType: 'MEDICAL', reason: 'Medical certificate received' },
    })).resolves.toEqual(corrected);

    expect(mutations.some(({ sql }) => sql.startsWith('UPDATE plugin_wattanam_attendance_manager_record'))).toBe(true);
    const history = mutations.find(({ sql }) => sql.startsWith('INSERT INTO plugin_wattanam_attendance_manager_correction'));
    expect(history?.params).toEqual(expect.arrayContaining([
      JSON.stringify({ status: 'ABSENT', permissionType: null }),
      JSON.stringify({ status: 'PERMISSION', permissionType: 'MEDICAL' }),
    ]));
    expect(durable).toHaveBeenCalledWith(expect.objectContaining({ event: 'wattanam.attendance-manager.attendance.corrected', version: 1, subjectKey: 'record-1' }));
    expect(transient).toHaveBeenCalledWith('attendance.corrected.v1', expect.any(Object));
  });

  it('enforces teacher, student, and parent row scope before attendance reads', async () => {
    const routes: any[] = [];
    const databaseQuery = jest.fn().mockResolvedValue([]);
    const classesForUser = jest.fn(async (userId: string) => userId === 'teacher-1' ? ['class-1'] : []);
    const roster = {
      contract: { id: 'wattanam.academic-management.roster', version: '1.0.0' },
      classId: 'class-1', className: 'Grade 1A', asOfIsoDate: '2026-09-25', source: 'plugin-enrollment-interval',
      students: [
        { studentId: 'student-1', userId: 'student-user-1', studentNumber: 'S001', name: 'One', parentId: 'parent-1' },
        { studentId: 'student-2', userId: 'student-user-2', studentNumber: 'S002', name: 'Two', parentId: 'parent-2' },
      ],
    };
    const context: any = {
      logger: { log: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } }, events: { publish: jest.fn() },
      readModels: { publish: jest.fn(), read: jest.fn() },
      directory: { classesForUser, getClassRoster: jest.fn().mockResolvedValue(roster) },
      database: { query: databaseQuery, execute: jest.fn(), transaction: jest.fn() },
    };
    await plugin.activate(context);
    const records = routes.find((candidate) => candidate.method === 'GET' && candidate.path === 'records');

    await expect(records.handler({ principal: { userId: 'teacher-2', role: 'TEACHER' }, query: { classId: 'class-1', date: '2026-09-25' } }))
      .rejects.toThrow('not assigned');
    await expect(records.handler({ principal: { userId: 'student-user-1', role: 'STUDENT' }, query: { classId: 'class-1', personId: 'student-2', date: '2026-09-25' } }))
      .rejects.toThrow('cannot access this student');
    await expect(records.handler({ principal: { userId: 'parent-1', role: 'PARENT' }, query: { classId: 'class-1', personId: 'student-1', date: '2026-09-25' } }))
      .resolves.toEqual([]);
    const scopedCall = databaseQuery.mock.calls.at(-1);
    expect(scopedCall[0]).toContain('"classId"');
    expect(scopedCall[0]).toContain('"personId"');
    expect(scopedCall[1]).toEqual(expect.arrayContaining(['class-1', 'student-1']));
  });

  it('applies one validated row-scoped filter contract to report, print and CSV projections', async () => {
    const routes: any[] = [];
    const databaseQuery = jest.fn(async (sql: string) => sql.includes('COUNT(*)') ? [{ personType: 'STUDENT', status: 'PRESENT', count: 1 }] : [{
      id: 'record-1', personId: 'student-1', personNameSnapshot: 'Student One', personNumberSnapshot: 'S001',
      classId: 'class-1', classNameSnapshot: 'Grade 1A', date: '2026-09-25', session: 1, status: 'PRESENT', scanMode: 'USB',
    }]);
    const context: any = {
      logger: { log: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } }, events: { publish: jest.fn() },
      readModels: { publish: jest.fn(), read: jest.fn() },
      directory: {
        classesForUser: jest.fn().mockResolvedValue(['class-1']),
        getClassRoster: jest.fn().mockResolvedValue({ classId: 'class-1', className: 'Grade 1A', students: [{ studentId: 'student-1' }] }),
      },
      database: { query: databaseQuery, execute: jest.fn(), transaction: jest.fn() },
    };
    await plugin.activate(context);
    const route = (method: string, routePath: string) => routes.find((candidate) => candidate.method === method && candidate.path === routePath);
    const principal = { userId: 'teacher-1', role: 'TEACHER' };
    const filtered = { principal, query: { classId: 'class-1', startDate: '2026-09-01', endDate: '2026-09-30', status: 'PRESENT', session: '1' } };

    await expect(route('GET', 'reports/summary').handler(filtered)).resolves.toHaveLength(1);
    await expect(route('GET', 'reports/print-data').handler(filtered)).resolves.toHaveLength(1);
    await expect(route('GET', 'reports/export-csv').handler(filtered)).resolves.toMatchObject({ filename: 'student-attendance.csv', content: expect.stringContaining('Student One') });
    await expect(route('GET', 'reports/class-progress').handler({ principal, query: { classId: 'class-1', date: '2026-09-25' } })).resolves.toMatchObject({ total: 1, marked: 1, percent: 100 });
    await expect(route('GET', 'reports/monthly-trend').handler({ principal, query: { classId: 'class-1', year: '2026', month: '9' } })).resolves.toBeDefined();
    await expect(route('GET', 'reports/summary').handler({ principal, query: { classId: 'class-1', startDate: '2026-10-01', endDate: '2026-09-01' } })).rejects.toThrow('startDate');
    await expect(route('GET', 'reports/daily-grid').handler({ principal, query: { classId: 'class-1', date: 'not-a-date' } })).rejects.toThrow('date is invalid');

    const sqlCalls = databaseQuery.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.some((sql) => sql.includes('"classId"') && sql.includes('"status"') && sql.includes('"session"'))).toBe(true);
  });

  it('registers an absence-alert job with per-recipient delivery idempotency and realtime refresh', async () => {
    const routes: any[] = []; let job: any; let alertStatus = 'PENDING';
    const deliveryStatus = new Map<string, string>();
    const notifyInApp = jest.fn().mockResolvedValue({ id: 'notification-1' });
    const notifyUser = jest.fn();
    const query = async (sql: string, params: unknown[] = []) => {
      if (sql.includes('alert_rule') && sql.includes('"enabled"=TRUE')) return [{ id: 'rule-1', code: 'absence', threshold: 2, windowDays: 7, channels: ['IN_APP', 'REALTIME'] }];
      if (sql.includes('attendance_manager_record') && sql.includes('HAVING COUNT')) return [{ personId: 'student-1', classId: 'class-1', count: 3 }];
      if (sql.includes('attendance_manager_alert_delivery') && sql.includes('WHERE "alertId"')) return [{ id: `${params[1]}-${params[2]}`, status: deliveryStatus.get(`${params[1]}:${params[2]}`) || 'PENDING' }];
      if (sql.includes('attendance_manager_alert') && sql.includes('"idempotencyKey"')) return [{ id: 'alert-1', status: alertStatus }];
      return [];
    };
    const execute = async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('UPDATE plugin_wattanam_attendance_manager_alert_delivery') && sql.includes("'SENT'")) deliveryStatus.set(`${params[0]}`.replace('-', ':'), 'SENT');
      if (sql.startsWith('UPDATE plugin_wattanam_attendance_manager_alert ') && sql.includes("'SENT'")) alertStatus = 'SENT';
      return { count: 1 };
    };
    const context: any = {
      logger: { log: jest.fn() }, permissions: { register: jest.fn() }, navigation: { register: jest.fn() },
      routes: { register: (route: any) => { routes.push(route); return () => undefined; } }, events: { publish: jest.fn() },
      readModels: { publish: jest.fn(), read: jest.fn() }, jobs: { register: jest.fn(async (definition) => { job = definition; return () => undefined; }) },
      notifications: { notifyInApp }, realtime: { notifyUser },
      directory: { getClassRoster: jest.fn().mockResolvedValue({ className: 'Grade 1A', students: [{ studentId: 'student-1', userId: 'student-user', parentId: 'parent-user', name: 'Student One' }] }) },
      database: { query, execute, transaction: jest.fn() },
    };
    await plugin.activate(context);
    expect(job).toMatchObject({ id: 'attendance-alerts', intervalSeconds: 900 });
    await job.handler();
    await job.handler();
    expect(notifyInApp).toHaveBeenCalledTimes(2);
    expect(notifyUser).toHaveBeenCalledTimes(2);
    expect(routes.find((route) => route.path === 'alerts/:id/acknowledge').permission).toBe('wattanam.attendance-manager.configure');
  });
});
