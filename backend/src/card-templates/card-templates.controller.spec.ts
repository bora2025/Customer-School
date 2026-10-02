import { CardTemplatesController, documentDesignerRouteOwner } from './card-templates.controller';

describe('CardTemplatesController compatibility routing', () => {
  const original = process.env.DOCUMENT_DESIGNER_ROUTE_OWNER;
  afterEach(() => {
    if (original === undefined) delete process.env.DOCUMENT_DESIGNER_ROUTE_OWNER;
    else process.env.DOCUMENT_DESIGNER_ROUTE_OWNER = original;
  });

  it('defaults to legacy and rejects ambiguous owner configuration', () => {
    delete process.env.DOCUMENT_DESIGNER_ROUTE_OWNER;
    expect(documentDesignerRouteOwner()).toBe('legacy');
    expect(() => documentDesignerRouteOwner('automatic')).toThrow('must be legacy or plugin');
  });

  it('keeps every operation on the legacy service before explicit cutover', async () => {
    process.env.DOCUMENT_DESIGNER_ROUTE_OWNER = 'legacy';
    const legacy = {
      findAll: jest.fn().mockResolvedValue(['legacy']), getActiveDesign: jest.fn(), findOne: jest.fn(),
      setActiveDesign: jest.fn(), create: jest.fn(), delete: jest.fn(),
    } as any;
    const extensions = { dispatch: jest.fn() } as any;
    const controller = new CardTemplatesController(legacy, extensions);
    await expect(controller.findAll({ user: { userId: 'u1', role: 'ADMIN' } })).resolves.toEqual(['legacy']);
    expect(legacy.findAll).toHaveBeenCalled();
    expect(extensions.dispatch).not.toHaveBeenCalled();
  });

  it('maps the legacy API shape to plugin routes after explicit cutover', async () => {
    process.env.DOCUMENT_DESIGNER_ROUTE_OWNER = 'plugin';
    const legacy = { findAll: jest.fn(), getActiveDesign: jest.fn(), findOne: jest.fn(), setActiveDesign: jest.fn(), create: jest.fn(), delete: jest.fn() } as any;
    const extensions = { dispatch: jest.fn().mockResolvedValue({ ok: true }) } as any;
    const controller = new CardTemplatesController(legacy, extensions);
    const req = { user: { userId: 'u1', role: 'ADMIN', email: 'admin@example.test' } };

    await controller.create({ name: 'Card', cardType: 'student', design: { cardType: 'student' } }, req);
    expect(extensions.dispatch).toHaveBeenCalledWith('wattanam.document-designer', expect.objectContaining({
      method: 'POST', path: 'templates', body: { name: 'Card', documentType: 'student', design: { cardType: 'student' } },
      principal: { userId: 'u1', role: 'ADMIN', email: 'admin@example.test' },
    }));
    await controller.setActiveDesign('student', { design: { cardType: 'student' } }, req);
    expect(extensions.dispatch).toHaveBeenLastCalledWith('wattanam.document-designer', expect.objectContaining({ method: 'PUT', path: 'active/student', params: { documentType: 'student' } }));
    expect(Object.values(legacy).some((fn: any) => fn.mock.calls.length)).toBe(false);
  });
});
