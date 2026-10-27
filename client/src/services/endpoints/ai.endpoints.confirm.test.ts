import { describe, expect, it, vi } from 'vitest';
import { callApiServices } from '../callApiServices';
import { confirmAiActionRequest } from './ai.endpoints';

// The confirm request itself, with the network call stubbed: in jsdom a request whose FormData
// holds a File never completes, so this checks the body confirmAiActionRequest builds.
vi.mock('../callApiServices', () => ({ callApiServices: vi.fn(async () => ({ data: {}, headers: {} })) }));

describe('confirmAiActionRequest', () => {
  it('sends a file as multipart: the file, plus the edited values as JSON text', async () => {
    const file = new File(['%PDF-1.4'], 'handbook.pdf', { type: 'application/pdf' });
    const values = { title: 'Employee handbook', description: 'The rules', category: 'HR', status: 'active' as const };
    await confirmAiActionRequest('d1', values, file);
    const [path, method, auth, payload] = vi.mocked(callApiServices).mock.calls[0];
    expect([path, method, auth]).toEqual(['/ai/actions/d1/confirm', 'post', true]);
    expect(payload).toBeInstanceOf(FormData);
    expect(JSON.parse((payload as FormData).get('values') as string)).toEqual(values);
    expect(((payload as FormData).get('file') as File).name).toBe('handbook.pdf');
  });

  it('leaves the values out when nothing was edited, and stays JSON without a file', async () => {
    vi.mocked(callApiServices).mockClear();
    await confirmAiActionRequest('d1', undefined, new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    expect((vi.mocked(callApiServices).mock.calls[0][3] as FormData).has('values')).toBe(false);
    await confirmAiActionRequest('d2', undefined);
    expect(vi.mocked(callApiServices).mock.calls[1][3]).toEqual({});
  });
});
