import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

// Academic Management's own Manage Classes screen (ui/classes, plugin >= 0.5.0) rendered from the
// real plugin files inside the core's sandboxed frame. Excel files are checked against ExcelJS in
// both directions: the screen must read a workbook ExcelJS wrote, and ExcelJS must read the
// workbooks the screen writes.
const pluginId = 'wattanam.academic-management';
const catalog = process.env.PLUGIN_SOURCE_CATALOG;
const root = catalog ? path.resolve(catalog, pluginId) : '';
const descriptorPath = root ? path.join(root, 'frontend/page.json') : '';
const descriptor = descriptorPath && fs.existsSync(descriptorPath) ? JSON.parse(fs.readFileSync(descriptorPath, 'utf8')) : { pages: [] };
const classesPage = descriptor.pages.find((page: any) => (page.components || []).some((component: any) => component.type === 'app' && component.options?.entry === 'ui/classes/index.html'));
const version = root && fs.existsSync(path.join(root, 'plugin.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')).version : '0.0.0';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-modals allow-downloads";
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function sheetRows(file: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  const rows: string[][] = [];
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((value) => String(value ?? ''))));
  return { name: sheet.name, rows, headerBold: sheet.getRow(1).getCell(1).font?.bold === true };
}

(classesPage ? test : test.skip)('Academic Management classes run as the plugin\'s own sandboxed screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop cover the layout');
  const pages = descriptor.pages.map((entry: any) => ({ pluginId, pluginVersion: version, schemaVersion: 2, kind: 'declarative-ui', ...entry }));
  const years = [{ id: 'y0', label: '2025-2026' }, { id: 'y1', label: '2026-2027', isCurrent: true }];
  const teachers = [{ id: 't1', name: 'Kim Vuthy', email: 'vuthy@example.test' }, { id: 't2', name: 'Chan Sophea', email: 'sophea@example.test' }];
  const classes: any[] = [
    { id: 'c1', name: 'Grade 7A', subject: 'Science', teacherId: 't1', teacher: teachers[0], studyYearId: 'y1', studyYear: years[1], studentCount: 2, registrationStatus: 'AVAILABLE', schedule: JSON.stringify({ attendanceFormat: 'MORNING', week: ['MON', 'TUE', 'WED'] }) },
    { id: 'c2', name: 'Grade 6B', teacherId: 't2', teacher: teachers[1], studyYearId: 'y0', studyYear: years[0], studentCount: 9, registrationStatus: 'HIDDEN' },
  ];
  const students: any[] = [{ id: 's1', studentNumber: '0001', name: 'Sok Dara', nameKh: 'សុខ ដារ៉ា', sex: 'MALE', dateOfBirth: '2013-04-09T00:00:00.000Z', address: 'Siem Reap', user: { phone: '012 000 111', email: 'dara@example.test' } }];
  const available = [{ id: 's9', studentNumber: '0009', name: 'Ly Bopha' }];
  const saved: Array<{ method: string; path: string; body: any }> = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const prefix = `/api/plugin-ui/${pluginId}/${version}/`;
    if (pathname.startsWith(prefix)) {
      const file = path.join(root, ...pathname.slice(prefix.length).split('/'));
      if (!file.startsWith(path.join(root, 'ui')) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, headers: { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cross-origin-resource-policy': 'cross-origin' }, body: fs.readFileSync(file) });
    }
    if (pathname === '/api/auth/me') return route.fulfill({ json: { id: 'admin-1', role: 'SUPER_ADMIN', email: 'admin@example.test' } });
    if (pathname === '/api/plugin-api/my-extensions') return route.fulfill({ json: { navigation: [], pages } });
    const apiPrefix = `/api/plugin-api/${pluginId}/`;
    if (pathname.startsWith(apiPrefix)) {
      const apiPath = pathname.slice(apiPrefix.length);
      if (request.method() === 'GET') {
        if (apiPath === 'classes') return route.fulfill({ json: classes });
        if (apiPath === 'study-years') return route.fulfill({ json: years });
        if (apiPath === 'teachers') return route.fulfill({ json: teachers });
        if (apiPath === 'class-admins') return route.fulfill({ json: [] });
        if (apiPath === 'classes/c1/students') return route.fulfill({ json: students });
        if (apiPath === 'classes/c1/available-students') return route.fulfill({ json: available });
        return route.fulfill({ json: [] });
      }
      const body = request.method() === 'DELETE' ? null : request.postDataJSON();
      saved.push({ method: request.method(), path: apiPath, body });
      if (apiPath === 'classes' && request.method() === 'POST') classes.push({ id: 'c3', ...body, teacher: teachers.find((item) => item.id === body.teacherId), studyYear: years.find((item) => item.id === body.studyYearId), studentCount: 0 });
      if (apiPath === 'classes/c1' && request.method() === 'PUT') Object.assign(classes[0], body);
      if (apiPath === 'classes/c1/students/create') return route.fulfill({ status: 201, json: { id: 's7', studentNumber: '0007', password: 'Made1234' } });
      if (apiPath === 'classes/c1/students/bulk-csv') return route.fulfill({ status: 201, json: { success: 2, errors: 1, skipped: 0, details: [{ row: 2, id: '0101', name: 'Neang Sreyleak', status: 'SUCCESS', password: 'Abcd2345' }, { row: 3, id: '0102', name: 'Bad Row', status: 'FAILED', error: 'Email is invalid' }] } });
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ status: 200, json: [] });
  });

  await page.goto(`/plugins/${pluginId}/${classesPage.routePath}`);
  const frame = page.frameLocator('iframe[title="Manage Classes"]');
  await expect(frame.getByRole('heading', { name: '🏫 Manage Classes' })).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('.class')).toHaveCount(2);
  await expect(frame.locator('.class').filter({ hasText: 'Grade 7A' })).toContainText('Study days: Mon, Tue, Wed');
  await expect(frame.locator('.class').filter({ hasText: 'Grade 7A' })).toContainText('Morning Only');

  // Filters and sorting.
  await frame.getByLabel('Study year').selectOption('y1');
  await expect(frame.locator('.class')).toHaveCount(1);
  await frame.getByLabel('Study year').selectOption('');
  await frame.getByLabel('Sort classes').selectOption('students');
  await expect(frame.locator('.class h2').first()).toHaveText('Grade 6B');
  await frame.getByLabel('Search classes').fill('vuthy');
  await expect(frame.locator('.class')).toHaveCount(1);
  await frame.getByLabel('Search classes').fill('');

  // Create: validation first, then one request with the chosen teacher and study days.
  await frame.getByRole('button', { name: '＋ Add Class' }).click();
  await frame.locator('#c-name').fill('Grade 8C');
  await frame.getByRole('button', { name: 'Create Class' }).click();
  await expect(frame.locator('#class-error')).toHaveText('Class name and teacher are required.');
  await frame.locator('#c-teacher').fill('Somebody Else');
  await frame.getByRole('button', { name: 'Create Class' }).click();
  await expect(frame.locator('#class-error')).toHaveText('Choose the teacher from the list.');
  expect(saved).toHaveLength(0);
  await frame.locator('#c-teacher').fill('Chan Sophea');
  await frame.getByRole('button', { name: /Full Day/ }).click();
  await frame.getByRole('button', { name: 'Mon–Sat' }).click();
  await frame.locator('#c-price').fill('39.5');
  // the level decides which score sheets the class can use; a new class must have one
  await frame.getByRole('button', { name: 'Create Class' }).click();
  await expect(frame.locator('#class-error')).toContainText('Choose the class level: primary school');
  await expect(frame.locator('#c-levels [data-level]')).toHaveCount(5);
  await expect(frame.locator('#c-levels [data-level="PRIMARY"]')).toContainText('Primary school');
  await frame.locator('#c-levels [data-level="SECONDARY"]').click();
  await frame.getByRole('button', { name: 'Create Class' }).click();
  await expect(frame.getByRole('status')).toHaveText('Class created successfully.');
  expect(saved[0]).toMatchObject({ method: 'POST', path: 'classes', body: { name: 'Grade 8C', level: 'SECONDARY', teacherId: 't2', classAdminId: null, studyYearId: 'y1', registrationStatus: 'HIDDEN', price: 39.5, showPrice: false } });
  expect(JSON.parse(saved[0].body.schedule)).toEqual({ attendanceFormat: 'FULL', week: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] });
  await expect(frame.locator('.class')).toHaveCount(3);

  // Study days only.
  await frame.locator('.class').filter({ hasText: 'Grade 7A' }).getByRole('button', { name: '📅 Edit Study Days' }).click();
  await frame.getByRole('button', { name: 'Weekend only' }).click();
  await frame.getByRole('button', { name: 'Save Study Days' }).click();
  await expect(frame.getByRole('status')).toHaveText('Study days updated for Grade 7A.');
  expect(JSON.parse(saved[1].body.schedule)).toEqual({ attendanceFormat: 'MORNING', week: ['SAT', 'SUN'] });

  // Students of a class.
  await frame.locator('.class').filter({ hasText: 'Grade 7A' }).getByRole('button', { name: /Students/ }).click();
  await expect(frame.locator('#students-title')).toHaveText('Class Students (1)');
  await expect(frame.locator('#students tr')).toContainText('សុខ ដារ៉ា');
  await frame.locator('#available').getByRole('button', { name: 'Add' }).click();
  await expect.poll(() => saved.at(-1)).toMatchObject({ method: 'POST', path: 'classes/c1/students', body: { studentId: 's9' } });

  // The Excel template the screen writes opens in ExcelJS with the styled header and text IDs.
  const [template] = await Promise.all([page.waitForEvent('download'), frame.getByRole('button', { name: '↓ Download Excel Template' }).click()]);
  expect(template.suggestedFilename()).toBe('student-import-template.xlsx');
  const templateSheet = await sheetRows(await template.path());
  expect(templateSheet.name).toBe('Student Import');
  expect(templateSheet.headerBold).toBe(true);
  // the student, then place of birth, current address and parents (one Address column in older files still imports)
  expect(templateSheet.rows[0]).toEqual(['ID', 'Name', 'Sex', 'Email', 'Phone', 'Photo', 'Date of Birth', 'Generation', 'Khmer Name',
    'Birth Village (ភូមិកំណើត)', 'Birth Commune (ឃុំ/សង្កាត់កំណើត)', 'Birth District (ស្រុក/ខណ្ឌកំណើត)', 'Birth Province (ខេត្ត/រាជធានីកំណើត)',
    'House No (ផ្ទះលេខ)', 'Street (ផ្លូវ)', 'Village (ភូមិ/ក្រុម)', 'Commune (ឃុំ/សង្កាត់)', 'District (ស្រុក/ខណ្ឌ)', 'Province (ខេត្ត/រាជធានី)',
    'Father Name (ឈ្មោះឪពុក)', 'Father Job (មុខរបរឪពុក)', 'Father Phone (ទូរស័ព្ទឪពុក)', 'Mother Name (ឈ្មោះម្ដាយ)', 'Mother Job (មុខរបរម្ដាយ)', 'Mother Phone (ទូរស័ព្ទម្ដាយ)']);
  expect(templateSheet.rows[1][0]).toBe('0001');
  expect(templateSheet.rows[1][8]).toBe('ឈ្មោះសិស្ស');
  expect(templateSheet.rows[1][19]).toBe('សុខ ចាន់');
  const [exported] = await Promise.all([page.waitForEvent('download'), frame.getByRole('button', { name: '↓ Export Students Excel' }).click()]);
  expect(exported.suggestedFilename()).toBe('Grade 7A-students.xlsx');
  const exportedSheet = await sheetRows(await exported.path());
  expect(exportedSheet.rows[1].slice(0, 5)).toEqual(['0001', 'Sok Dara', 'MALE', 'dara@example.test', '012 000 111']);
  expect(exportedSheet.rows[1][6]).toBe('2013-04-09');

  // A workbook written by ExcelJS (compressed, shared strings, a real date cell, a number) is read
  // by the screen and sent as CSV.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(['ID', 'Name', 'Sex', 'Email', 'Phone', 'Password', 'Photo', 'Date of Birth', 'Address', 'Generation', 'Khmer Name']);
  sheet.addRow(['0101', 'Neang Sreyleak', 'FEMALE', 'leak@example.test', '011222333', 'change-me-123', '', new Date(Date.UTC(2012, 6, 4)), 'Street 5, "Old Market"', 2026, 'នាង ស្រីលក្ខណ៍']);
  sheet.addRow(['0102', 'Bad Row', 'MALE', 'not-an-email', '', 'change-me-123', '', '', 'Phnom Penh', 2026, '']);
  sheet.getColumn(8).numFmt = 'yyyy-mm-dd';
  const upload = testInfo.outputPath('students.xlsx');
  await workbook.xlsx.writeFile(upload);
  await frame.locator('#upload-file').setInputFiles(upload);
  await expect(frame.locator('#students-message')).toContainText('Import complete: 2 succeeded, 1 failed, 0 skipped.');
  const csv = String(saved.find((entry) => entry.path === 'classes/c1/students/bulk-csv')!.body.csv).split('\n');
  expect(csv).toHaveLength(3);
  expect(csv[0]).toBe('ID,Name,Sex,Email,Phone,Password,Photo,Date of Birth,Address,Generation,Khmer Name');
  expect(csv[1]).toBe('0101,Neang Sreyleak,FEMALE,leak@example.test,011222333,change-me-123,,2012-07-04,"Street 5, ""Old Market""",2026,នាង ស្រីលក្ខណ៍');
  expect(csv[2]).toBe('0102,Bad Row,MALE,not-an-email,,change-me-123,,,Phnom Penh,2026,');
  await expect(frame.locator('#import-rows tr')).toHaveCount(2);
  await expect(frame.locator('#import-rows')).toContainText('Email is invalid');
  await expect(frame.locator('#import-rows')).toContainText('Abcd2345');
  await expect(frame.locator('#students-message')).toContainText('Sign-in passwords were made for 1 new student');

  // Register a student, then remove one (native confirmation works inside the sandbox).
  await frame.getByRole('button', { name: '＋ Register New Student' }).click();
  await frame.locator('#s-name').fill('Vann Dy');
  // no password field: one is made by the server and shown once
  await expect(frame.locator('#s-password')).toHaveCount(0);
  // place of birth, current address and parents
  await expect(frame.locator('#s-details legend')).toHaveText(['Place of birth · ទីកន្លែងកំណើត', 'Current address · អាសយដ្ឋានបច្ចុប្បន្ន', 'Parents · ឪពុកម្ដាយ']);
  await frame.locator('[data-detail="birthProvince"]').fill('ខេត្តតាកែវ');
  await frame.locator('[data-detail="street"]').fill('271');
  await frame.locator('[data-detail="fatherName"]').fill('សុខ ចាន់');
  await frame.locator('[data-detail="motherPhone"]').fill('012333444');
  await frame.getByRole('button', { name: 'Create Student' }).click();
  await expect(frame.locator('#students-message')).toContainText('ID card were created');
  await expect(frame.locator('#students-message')).toContainText('Sign-in password for Vann Dy: Made1234');
  const created = saved.find((entry) => entry.path === 'classes/c1/students/create')!;
  expect(created.body.password).toBeUndefined();
  expect(created.body).toMatchObject({ name: 'Vann Dy', studentNumber: null, email: null, birthProvince: 'ខេត្តតាកែវ', street: '271', fatherName: 'សុខ ចាន់', motherPhone: '012333444', motherName: '' });
  expect(String(created.body.commandKey)).toMatch(/^class-student:/);
  page.once('dialog', (dialog) => dialog.accept());
  await frame.locator('#students').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => saved.at(-1)).toMatchObject({ method: 'DELETE', path: 'classes/c1/students/s1' });
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-class-students-${testInfo.project.name}.png`), fullPage: true });

  // Back to the list; Attendance opens the attendance screen for that class.
  await frame.locator('#students-view').getByRole('button', { name: '← Back to classes' }).click();
  if (process.env.APPEARANCE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.APPEARANCE_SCREENSHOT_DIR, `academic-classes-${testInfo.project.name}.png`), fullPage: true });
  await frame.locator('.class').filter({ hasText: 'Grade 7A' }).getByRole('button', { name: 'Attendance' }).click();
  await expect(page).toHaveURL(new RegExp(`/plugins/${pluginId}/attendance[?]classId=c1$`));
});
