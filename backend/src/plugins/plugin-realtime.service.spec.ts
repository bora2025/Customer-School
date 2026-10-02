import { PluginRealtimeService } from './plugin-realtime.service';

describe('PluginRealtimeService', () => {
  it('emits to the user room under a plugin-namespaced event name', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const gateway = { server: { to } } as any;
    const service = new PluginRealtimeService(gateway);

    service.notifyUser('wattanam.announcements', 'user-1', 'announcement:new', { id: 'a1' });

    expect(to).toHaveBeenCalledWith('user-user-1');
    expect(emit).toHaveBeenCalledWith('plugin:wattanam.announcements:announcement:new', { id: 'a1' });
  });

  it('cannot be made to emit a bare core event name — the plugin prefix is always applied', () => {
    const emit = jest.fn();
    const gateway = { server: { to: jest.fn(() => ({ emit })) } } as any;
    const service = new PluginRealtimeService(gateway);

    service.notifyUser('wattanam.evil', 'user-1', '', { forged: true });

    expect(emit).toHaveBeenCalledWith('plugin:wattanam.evil:', { forged: true });
    expect(emit).not.toHaveBeenCalledWith('message:new', expect.anything());
  });
});
