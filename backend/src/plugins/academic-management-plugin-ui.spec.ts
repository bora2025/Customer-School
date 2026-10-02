import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePluginUiBundle } from './plugin-ui-schema';

describe('Academic Management declarative administration UI', () => {
  const pluginRoot = path.resolve(__dirname, '../../../plugins/wattanam.academic-management');
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  const descriptor = JSON.parse(readFileSync(path.join(pluginRoot, 'frontend/page.json'), 'utf8'));
  const backendSource = readFileSync(path.join(pluginRoot, 'backend/index.js'), 'utf8');
  const bundle = parsePluginUiBundle(descriptor, manifest.id, new Set(manifest.permissions));

  it('exposes registration settings through the plugin navigation', () => {
    expect(manifest.version).toBe('0.1.15');
    expect(manifest.navigation).toContainEqual(expect.objectContaining({
      id: 'registration-settings',
      href: '/plugins/wattanam.academic-management/registration-settings',
      permission: 'wattanam.academic-management.manage',
    }));
  });

  it('exposes Academic-owned study years and the rich classes entry points', () => {
    expect(manifest.navigation).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'study-years', href: '/plugins/wattanam.academic-management/study-years' }),
      expect.objectContaining({ id: 'classes', href: '/plugins/wattanam.academic-management/classes' }),
    ]));
    const page = bundle.pages.find((candidate) => candidate.id === 'study-years');
    expect(page?.dataSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'studyYears', method: 'GET', path: 'study-years' }),
      expect.objectContaining({ id: 'createStudyYear', method: 'POST', path: 'study-years' }),
      expect.objectContaining({ id: 'setCurrentStudyYear', method: 'POST', path: 'study-years/:studyYearId/set-current', autoload: false }),
      expect.objectContaining({ id: 'deleteStudyYear', method: 'DELETE', path: 'study-years/:studyYearId', autoload: false }),
    ]));
    expect(page?.components.map((component) => component.id)).toEqual(expect.arrayContaining([
      'study-years-table', 'study-year-actions', 'study-year-create-form',
    ]));
    expect(bundle.pages).toContainEqual(expect.objectContaining({ id: 'study-year-edit', routePath: 'study-years/edit/:id' }));
    const classes = bundle.pages.find((candidate) => candidate.id === 'classes');
    expect(classes?.components.find((component) => component.id === 'classes-table')?.options).toMatchObject({
      rowRoute: 'classes/:id', rowParameterMap: { id: 'id' },
    });
    for (const route of [
      "path: 'study-years'",
      "path: 'study-years/:id'",
      "path: 'study-years/:id/set-current'",
    ]) expect(backendSource).toContain(route);
    expect(backendSource).toContain('Cannot delete a study year that still has classes');
    expect(backendSource).not.toContain("readModels.read('wattanam.attendance-manager', 'study-year'");
  });

  it('binds settings and custom-field controls to plugin-owned routes', () => {
    const page = bundle.pages.find((candidate) => candidate.id === 'registration-settings');
    expect(page).toBeDefined();
    expect(page?.dataSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'registrationSettings', method: 'GET', path: 'admissions/settings' }),
      expect.objectContaining({ id: 'saveRegistrationSettings', method: 'PATCH', path: 'admissions/settings' }),
      expect.objectContaining({ id: 'customFields', method: 'GET', path: 'admissions/fields' }),
      expect.objectContaining({ id: 'createCustomField', method: 'POST', path: 'admissions/fields' }),
      expect.objectContaining({ id: 'deleteCustomField', method: 'DELETE', path: 'admissions/fields/:fieldId', autoload: false }),
    ]));
    expect(page?.components.map((component) => component.id)).toEqual(expect.arrayContaining([
      'registration-settings-form',
      'custom-fields-table',
      'custom-field-actions',
      'custom-field-create-form',
    ]));
    const createForm = page?.components.find((component) => component.id === 'custom-field-create-form');
    expect(createForm?.fields).toContainEqual(expect.objectContaining({
      id: 'options', jsonShape: 'array', defaultValue: [],
    }));
  });
});
