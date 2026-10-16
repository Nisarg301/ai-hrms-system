import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { uploadTaskFileRequest } from '../../services/endpoints/lifecycle.endpoints';
import { useAppSelector } from '../../hooks/store';
import { makeTestStore } from '../../test/makeTestStore';
import { lcTask, myProcess } from '../../test/lifecycleFixtures';
import type { LifecycleTask } from '../../types/lifecycle';
import { LifecycleTaskDrawer } from './LifecycleTaskDrawer';

// jsdom's multipart bodies can't be read by MSW, so the upload itself is mocked (like the document tests do).
vi.mock('../../services/endpoints/lifecycle.endpoints', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/endpoints/lifecycle.endpoints')>()),
  uploadTaskFileRequest: vi.fn(),
}));

let task: LifecycleTask;
let completed: unknown[];
let completeFails: { status: number; body: object } | null;

beforeEach(() => {
  completed = [];
  completeFails = null;
  server.use(
    http.post(`${API_BASE_URL}/lifecycle/tasks/:id/complete`, async ({ request }) => {
      const body = await request.json();
      completed.push(body);
      if (completeFails) return HttpResponse.json(completeFails.body, { status: completeFails.status });
      task = { ...task, status: 'done', completedByName: 'Ivy Mehta', completedAt: '2026-10-05T05:00:00.000Z' };
      return HttpResponse.json({ success: true, data: task });
    }),
    http.get(`${API_BASE_URL}/lifecycle/tasks/:id/files/:fileId`, () => new HttpResponse(new Blob(['pdf'], { type: 'application/pdf' }))),
    http.delete(`${API_BASE_URL}/lifecycle/tasks/:id/files/:fileId`, ({ params }) => {
      task = { ...task, files: task.files.filter((f) => f.id !== params.fileId) };
      return HttpResponse.json({ success: true, data: task });
    })
  );
  vi.mocked(uploadTaskFileRequest).mockImplementation(async (_taskId, file) => {
    task = { ...task, files: [...task.files, { id: `f${task.files.length + 1}`, originalName: file.name, mimeType: file.type, size: file.size }] };
    return { data: structuredClone(task) } as Awaited<ReturnType<typeof uploadTaskFileRequest>>;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The drawer shows the task from the store, as Home does, so uploads and removals show up. */
function Harness({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const shown = useAppSelector((s) => s.lifecycle.mine.flatMap((p) => p.tasks).find((t) => t.id === task.id) ?? null);
  return <LifecycleTaskDrawer task={shown} whose="Your onboarding" today="2026-10-05" onClose={onClose} onDone={onDone} />;
}

function renderDrawer(t: LifecycleTask) {
  task = t;
  const onClose = vi.fn();
  const onDone = vi.fn();
  const store = makeTestStore({ lifecycle: { mine: [myProcess({ tasks: [t] })], mineStatus: 'succeeded', assigned: [], assignedStatus: 'succeeded' } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Harness onClose={onClose} onDone={onDone} />
      </MemoryRouter>
    </Provider>
  );
  return { onClose, onDone, store };
}

const drawer = () => document.querySelector('.ant-drawer-open') as HTMLElement;
const doneButton = (name: RegExp = /Mark as done/) => within(drawer()).getByRole('button', { name });

describe('LifecycleTaskDrawer', () => {
  it('marks a plain task done with a note', async () => {
    const { onClose, onDone } = renderDrawer(
      lcTask('t1', { title: 'Introduce yourself', instructions: 'Say hello on the Welcome tab.', link: '/home?tab=welcome', dueDate: '2026-10-13' })
    );
    expect(within(drawer()).getByText('Your onboarding')).toBeInTheDocument();
    expect(within(drawer()).getByText('Say hello on the Welcome tab.')).toBeInTheDocument();
    expect(within(drawer()).getByText('Due Tue, 13 Oct')).toBeInTheDocument();
    expect(within(drawer()).getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/home?tab=welcome');

    await userEvent.click(within(drawer()).getByLabelText('Note (optional)'));
    await userEvent.paste('Posted!');
    await userEvent.click(doneButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(completed).toEqual([{ note: 'Posted!' }]);
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText('Done: Introduce yourself')).toBeInTheDocument();
  });

  it('needs a file for an upload task; files can be opened and removed', async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:file'), revokeObjectURL: vi.fn() });
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
    renderDrawer(lcTask('t2', { title: 'Upload ID and address proof', type: 'upload' }));
    expect(within(drawer()).getByText('Upload')).toBeInTheDocument();
    expect(doneButton()).toBeDisabled();
    expect(within(drawer()).getByText('Add at least one file to mark it done.')).toBeInTheDocument();

    const file = new File(['%PDF'], 'aadhaar.pdf', { type: 'application/pdf' });
    await userEvent.upload(drawer().querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(await within(drawer()).findByText('aadhaar.pdf')).toBeInTheDocument();
    expect(doneButton()).toBeEnabled();

    await userEvent.click(within(drawer()).getByRole('button', { name: 'aadhaar.pdf' }));
    await waitFor(() => expect(tab.location.href).toBe('blob:file'));

    await userEvent.click(within(drawer()).getByLabelText('Remove aadhaar.pdf'));
    await waitFor(() => expect(within(drawer()).queryByText('aadhaar.pdf')).not.toBeInTheDocument());
    expect(doneButton()).toBeDisabled();
  });

  it('refuses files that are not PDF, JPG or PNG', async () => {
    renderDrawer(lcTask('t2', { type: 'upload' }));
    const input = drawer().querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
    expect(await screen.findByText('Files can be PDF, JPG or PNG')).toBeInTheDocument();
    expect(uploadTaskFileRequest).not.toHaveBeenCalled();
  });

  it('needs the tick to confirm reading', async () => {
    renderDrawer(lcTask('t3', { title: 'Read the company policies', type: 'acknowledge', link: 'https://example.com/policies' }));
    const link = within(drawer()).getByRole('link', { name: /Open link/ });
    expect(link).toHaveAttribute('href', 'https://example.com/policies');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    expect(doneButton()).toBeDisabled();
    await userEvent.click(within(drawer()).getByLabelText('I’ve read this'));
    await userEvent.click(doneButton());
    await waitFor(() => expect(completed).toEqual([{ note: '', acknowledged: true }]));
  });

  it("needs every answer on a form, and shows the server's reason", async () => {
    const { onDone } = renderDrawer(lcTask('t4', { title: 'Exit interview', type: 'form', questions: ['Why are you leaving?', 'What went well?'] }));
    expect(within(drawer()).getByText('Only your admins will see your answers.')).toBeInTheDocument();
    const submit = doneButton(/Submit answers/);
    expect(submit).toBeDisabled();
    await userEvent.click(within(drawer()).getByLabelText('Why are you leaving?'));
    await userEvent.paste('Growth');
    expect(submit).toBeDisabled();
    await userEvent.click(within(drawer()).getByLabelText('What went well?'));
    await userEvent.paste('The people');

    completeFails = { status: 400, body: { success: false, error: { message: 'Validation failed', details: { fieldErrors: { answers: ['Answer every question'] } } } } };
    await userEvent.click(submit);
    expect(await within(drawer()).findByText('Answer every question')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    completeFails = null;
    await userEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(completed.at(-1)).toEqual({ note: '', answers: ['Growth', 'The people'] });
  });

  it('shows how a finished task ended, without actions', async () => {
    renderDrawer(
      lcTask('t5', {
        title: 'Upload ID and address proof',
        type: 'upload',
        status: 'done',
        completedByName: 'Ivy Mehta',
        completedAt: '2026-10-05T05:00:00.000Z',
        note: 'Both attached',
        files: [{ id: 'f1', originalName: 'aadhaar.pdf', mimeType: 'application/pdf', size: 4 }],
      })
    );
    expect(within(drawer()).getByText('Done by Ivy Mehta on 5 Oct 2026')).toBeInTheDocument();
    expect(within(drawer()).getByText('“Both attached”')).toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: 'aadhaar.pdf' })).toBeInTheDocument();
    expect(within(drawer()).queryByLabelText('Remove aadhaar.pdf')).not.toBeInTheDocument();
    expect(within(drawer()).queryByRole('button', { name: /Mark as done/ })).not.toBeInTheDocument();
  });

  it('says why a task was skipped', async () => {
    renderDrawer(lcTask('t6', { status: 'skipped', skipReason: 'Covered in the team lunch' }));
    expect(within(drawer()).getByText('Covered in the team lunch')).toBeInTheDocument();
    expect(within(drawer()).queryByRole('button', { name: /Mark as done/ })).not.toBeInTheDocument();
  });
});
