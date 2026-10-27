import request from 'supertest';
import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { PLAN_FEATURES, PLAN_MODULES } from '../../src/constants/modules';

// The HTTP layer of the assistant: route guards, validation and the event stream.
// Sign-in and the plan lookup are stubbed; the chat turn itself is tested in employee.agent.test.ts.

let plan: 'basic' | 'professional' = 'professional';

jest.mock('../../src/middlewares/authenticate', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: new Types.ObjectId().toString(), organizationId: new Types.ObjectId().toString(), role: 'ORG_ADMIN', roleId: null, name: 'Ann' };
    next();
  },
}));
jest.mock('../../src/middlewares/requireActivePlan', () => ({
  requireActivePlan: (req: Request, _res: Response, next: NextFunction) => {
    req.subscription = { planType: plan, billingCycle: 'monthly', expiryDate: null, active: true, modules: [...PLAN_MODULES[plan]], features: [...PLAN_FEATURES[plan]] } as never;
    next();
  },
}));
jest.mock('../../src/ai/agent.service', () => ({
  ...jest.requireActual('../../src/ai/agent.service'),
  runTurn: jest.fn(async ({ emit }) => {
    emit({ type: 'status', state: 'thinking' });
    emit({ type: 'message', message: { role: 'assistant', text: '', result: { text: 'Hello' }, action: null, createdAt: '2026-10-16T00:00:00.000Z' } });
    emit({ type: 'done', conversationId: 'c1' });
  }),
  confirmAction: jest.fn(async () => ({ message: null, action: null, secrets: [] })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('../../src/app') as typeof import('../../src/app');

describe('/api/v1/ai', () => {
  beforeEach(() => {
    plan = 'professional';
  });

  it('streams a chat turn as server-sent events, uncompressed', async () => {
    const res = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', 'Bearer t')
      .set('Accept-Encoding', 'gzip')
      .send({ module: 'employees', message: 'Show all employees' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.text).toBe(
      'event: status\ndata: {"state":"thinking"}\n\n' +
        'event: message\ndata: {"message":{"role":"assistant","text":"","result":{"text":"Hello"},"action":null,"createdAt":"2026-10-16T00:00:00.000Z"}}\n\n' +
        'event: done\ndata: {"conversationId":"c1"}\n\n'
    );
  });

  it('is a Professional feature', async () => {
    plan = 'basic';
    const res = await request(app).post('/api/v1/ai/chat').send({ module: 'employees', message: 'hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toEqual({ code: 'FEATURE_NOT_IN_PLAN', feature: 'ai' });
  });

  it('takes a message or a tool call, not both', async () => {
    const res = await request(app)
      .post('/api/v1/ai/chat')
      .send({ module: 'employees', message: 'hi', toolCall: { name: 'list_employees', args: {} } });
    expect(res.status).toBe(400);
  });

  it('refuses an unknown module', async () => {
    const res = await request(app).post('/api/v1/ai/chat').send({ module: 'payroll', message: 'hi' });
    expect(res.status).toBe(400);
  });

  it("lists the admin's assistants with their starter chips", async () => {
    const res = await request(app).get('/api/v1/ai/modules');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ key: 'employees', title: 'Employees assistant' });
    expect(res.body.data[0].starters.map((s: { label: string }) => s.label)).toEqual(['Add employee', 'Show all employees', 'Count by department']);
  });

  describe('confirm with a file (an uploaded document)', () => {
    const confirmAction = (jest.requireMock('../../src/ai/agent.service') as { confirmAction: jest.Mock }).confirmAction;
    const url = () => `/api/v1/ai/actions/${new Types.ObjectId().toString()}/confirm`;
    beforeEach(() => confirmAction.mockClear());

    it('takes the file, checked by the upload middleware, and the edited values as JSON text', async () => {
      const res = await request(app)
        .post(url())
        .field('values', JSON.stringify({ title: 'Employee handbook', description: 'Rules', category: 'HR', status: 'active' }))
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'handbook.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(200);
      const input = confirmAction.mock.calls[0][0];
      expect(input.values).toEqual({ title: 'Employee handbook', description: 'Rules', category: 'HR', status: 'active' });
      expect(input.file).toMatchObject({ originalname: 'handbook.pdf', mimetype: 'application/pdf', size: 8 });
    });

    it('refuses a file type documents do not take, before anything runs', async () => {
      const res = await request(app).post(url()).attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Unsupported file type');
      expect(confirmAction).not.toHaveBeenCalled();
    });

    it('still takes a plain JSON confirm', async () => {
      const res = await request(app).post(url()).send({ values: { title: 'X' } });
      expect(res.status).toBe(200);
      expect(confirmAction.mock.calls[0][0]).toMatchObject({ values: { title: 'X' }, file: undefined });
    });
  });
});
