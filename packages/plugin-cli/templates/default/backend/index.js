'use strict';

module.exports = {
  id: '{{publisher}}.{{name}}',
  async activate(context) {
    context.logger.log('{{displayName}} activated');

    context.permissions.register([
      { id: '{{publisher}}.{{name}}.view', label: 'View {{displayName}} records' },
      { id: '{{publisher}}.{{name}}.manage', label: 'Manage {{displayName}} settings' },
    ]);
    context.navigation.register([
      { id: 'records', label: '{{displayName}}', href: '/plugins/{{publisher}}.{{name}}/records', permission: '{{publisher}}.{{name}}.view' },
    ]);

    context.routes.register({
      method: 'GET', path: 'records', permission: '{{publisher}}.{{name}}.view',
      handler: () => context.database.query('SELECT "id", "name", "status", "createdAt" FROM plugin_{{publisher}}_{{sqlName}}_widget ORDER BY "createdAt" DESC'),
    });
    context.routes.register({
      method: 'POST', path: 'records', permission: '{{publisher}}.{{name}}.manage',
      async handler(request) {
        const name = String(request.body?.name || '').trim();
        if (!name || name.length > 120) throw new Error('name is required and must not exceed 120 characters');
        const id = request.body?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await context.database.execute('INSERT INTO plugin_{{publisher}}_{{sqlName}}_widget ("id", "name", "status") VALUES ($1, $2, $3)', [id, name, 'active']);
        return { id, name, status: 'active' };
      },
    });
    context.routes.register({ method: 'GET', path: 'records/:id', permission: '{{publisher}}.{{name}}.view', async handler(request) {
      return (await context.database.query('SELECT "id", "name", "status", "createdAt" FROM plugin_{{publisher}}_{{sqlName}}_widget WHERE "id" = $1', [request.params.id]))[0] || null;
    } });
    context.routes.register({ method: 'PATCH', path: 'records/:id', permission: '{{publisher}}.{{name}}.manage', async handler(request) {
      const name = String(request.body?.name || '').trim();
      if (!name || name.length > 120) throw new Error('name is required and must not exceed 120 characters');
      await context.database.execute('UPDATE plugin_{{publisher}}_{{sqlName}}_widget SET "name" = $1 WHERE "id" = $2', [name, request.params.id]);
      return { id: request.params.id, name };
    } });

    context.routes.register({
      method: 'GET', path: 'settings', permission: '{{publisher}}.{{name}}.manage',
      async handler() {
        return context.settings.get('preferences', { enabled: true });
      },
    });
    context.routes.register({
      method: 'PATCH', path: 'settings', permission: '{{publisher}}.{{name}}.manage',
      async handler(request) {
        const input = request.body && typeof request.body === 'object' ? request.body : {};
        const preferences = { enabled: input.enabled !== false };
        await context.settings.set('preferences', preferences);
        return preferences;
      },
    });
  },
  deactivate(context) {
    context.logger.log('{{displayName}} deactivated');
  },
  health() {
    return { status: 'ready' };
  },
};
