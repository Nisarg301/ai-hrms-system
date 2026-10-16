import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import { adminAuth } from '../../test/expenseFixtures';
import { lcPerson } from '../../test/lifecycleFixtures';
import type { ChecklistTemplate, TemplateTask } from '../../types/lifecycle';
import TemplatesPage from './TemplatesPage';

const task = (key: string, title: string, extra: Partial<TemplateTask> = {}): TemplateTask & { key: string } => ({
  key,
  title,
  instructions: '',
  assignee: { kind: 'admin', userId: null, name: null },
  dueOffsetDays: 0,
  type: 'task',
  questions: [],
  link: null,
  ...extra,
});

let templates: ChecklistTemplate[];
let writes: { method: string; path: string; body?: unknown }[];
let refuse: { status: number; body: object } | null;

beforeEach(() => {
  writes = [];
  refuse = null;
  templates = [
    {
      id: 't1',
      name: 'Standard onboarding',
      kind: 'onboarding',
      isDefault: true,
      updatedAt: '2026-09-30T00:00:00.000Z',
      tasks: [task('k1', 'Create email and system accounts', { dueOffsetDays: -2 }), task('k2', 'Prepare laptop', { dueOffsetDays: -1 }), task('k3', '30-day check-in', { dueOffsetDays: 30, assignee: { kind: 'manager', userId: null } })],
    },
    { id: 't2', name: 'Interns', kind: 'onboarding', isDefault: false, updatedAt: '2026-09-30T00:00:00.000Z', tasks: [task('k4', 'Meet the mentor')] },
    { id: 't3', name: 'Standard offboarding', kind: 'offboarding', isDefault: true, updatedAt: '2026-09-30T00:00:00.000Z', tasks: [task('k5', 'Exit interview', { dueOffsetDays: -2 })] },
  ];
  const ok = (data: unknown, status = 200) => HttpResponse.json({ success: true, data }, { status });
  server.use(
    http.get(`${API_BASE_URL}/people`, () => ok([lcPerson('u8', 'Bob Rao'), lcPerson('u9', 'Mia Shah')])),
    http.get(`${API_BASE_URL}/checklist-templates`, () => ok(templates)),
    http.post(`${API_BASE_URL}/checklist-templates`, async ({ request }) => {
      const body = (await request.json()) as ChecklistTemplate;
      writes.push({ method: 'POST', path: '/checklist-templates', body });
      if (refuse) return HttpResponse.json(refuse.body, { status: refuse.status });
      const created = { ...body, id: 't-new', isDefault: false, updatedAt: '2026-10-01T00:00:00.000Z', tasks: body.tasks.map((t, i) => ({ ...t, key: `n${i}` })) };
      templates.push(created);
      return ok(created, 201);
    }),
    http.put(`${API_BASE_URL}/checklist-templates/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Partial<ChecklistTemplate>;
      writes.push({ method: 'PUT', path: `/checklist-templates/${params.id}`, body });
      if (refuse) return HttpResponse.json(refuse.body, { status: refuse.status });
      const t = templates.find((x) => x.id === params.id)!;
      Object.assign(t, body);
      return ok(t);
    }),
    http.delete(`${API_BASE_URL}/checklist-templates/:id`, ({ params }) => {
      writes.push({ method: 'DELETE', path: `/checklist-templates/${params.id}` });
      templates = templates.filter((t) => t.id !== params.id);
      return ok({ id: params.id, deleted: true });
    }),
    http.post(`${API_BASE_URL}/checklist-templates/:id/make-default`, ({ params }) => {
      writes.push({ method: 'POST', path: `/checklist-templates/${params.id}/make-default` });
      const target = templates.find((t) => t.id === params.id)!;
      templates = templates.map((t) => (t.kind === target.kind ? { ...t, isDefault: t.id === target.id } : t));
      return ok(templates.find((t) => t.id === params.id));
    })
  );
});

function renderPage(url = '/people-ops/templates') {
  render(
    <Provider store={makeTestStore({ auth: adminAuth() })}>
      <MemoryRouter initialEntries={[url]}>
        <TemplatesPage />
      </MemoryRouter>
    </Provider>
  );
}

const card = (name: string) => screen.getByText(name).closest('[data-testid="template-card"]') as HTMLElement;
const editor = () => document.querySelector('.ant-drawer-open') as HTMLElement;
const taskCards = () => within(editor()).getAllByTestId('template-task');

async function pasteInto(input: HTMLElement, text: string) {
  await userEvent.click(input);
  await userEvent.paste(text);
}

describe('Checklist templates', () => {
  it('lists them by kind, default first; makes another the default; deletes one', async () => {
    renderPage();
    await screen.findByText('Standard onboarding');
    const cards = screen.getAllByTestId('template-card');
    expect(cards.map((c) => within(c).getByText(/onboarding|Interns/, { selector: '.ant-card-head-title span' }).textContent)).toEqual(['Standard onboardingDefault', 'Interns']);
    expect(card('Standard onboarding')).toHaveTextContent('2 days before joining');
    expect(card('Standard onboarding')).toHaveTextContent('30 days after joining');
    expect(within(card('Standard onboarding')).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Standard offboarding')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Make Interns the default' }));
    expect(await screen.findByText('Interns is now the default')).toBeInTheDocument();
    await waitFor(() => expect(within(card('Interns')).getByText('Default')).toBeInTheDocument());
    expect(within(card('Standard onboarding')).queryByText('Default')).not.toBeInTheDocument();

    await userEvent.click(within(card('Standard onboarding')).getByRole('button', { name: 'Delete Standard onboarding' }));
    const confirm = (await screen.findByText('Delete Standard onboarding?', { selector: '.ant-modal-confirm-title' })).closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Standard onboarding')).not.toBeInTheDocument());
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /checklist-templates/t2/make-default', 'DELETE /checklist-templates/t1']);

    await userEvent.click(screen.getByRole('tab', { name: 'Offboarding' }));
    expect(await screen.findByText('Standard offboarding')).toBeInTheDocument();
  });

  async function newTemplate() {
    renderPage();
    await screen.findByText('Standard onboarding');
    await userEvent.click(screen.getByRole('button', { name: /New onboarding template/ }));
    await waitFor(() => expect(editor()).toBeTruthy());
  }

  it('checks each task before saving, and says which one is wrong', async () => {
    await newTemplate();
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));
    expect(within(editor()).getByText('Name is required')).toBeInTheDocument();
    expect(within(taskCards()[0]).getByText('Give the task a title')).toBeInTheDocument();

    await pasteInto(within(taskCards()[0]).getByLabelText('Title'), 'Week-one survey');
    await userEvent.click(within(taskCards()[0]).getByLabelText('Type'));
    await userEvent.click(await screen.findByTitle('Form (questions)'));
    await userEvent.click(within(taskCards()[0]).getByLabelText('Who'));
    await userEvent.click(await screen.findByTitle('A specific person'));
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));
    expect(within(taskCards()[0]).getByText('Choose the person')).toBeInTheDocument();

    await userEvent.click(within(taskCards()[0]).getByLabelText('Person'));
    await userEvent.click(await screen.findByTitle('Bob Rao'));
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));
    expect(within(taskCards()[0]).getByText('A form needs at least one question')).toBeInTheDocument();
    expect(writes).toEqual([]);

    // Fixed: the form's questions and the named person are sent.
    await pasteInto(within(taskCards()[0]).getByLabelText('Task 1 question 1'), 'How was week one?');
    await pasteInto(within(editor()).getByLabelText('Name'), 'Surveys');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect((writes[0].body as { tasks: object[] }).tasks).toEqual([
        { title: 'Week-one survey', instructions: '', assignee: { kind: 'person', userId: 'u8' }, dueOffsetDays: 0, type: 'form', questions: ['How was week one?'], link: null },
      ])
    );
  });

  it('reorders tasks and sends the new template', async () => {
    await newTemplate();
    await pasteInto(within(editor()).getByLabelText('Name'), 'Engineering onboarding');
    await pasteInto(within(taskCards()[0]).getByLabelText('Title'), 'Set up the laptop');
    const due = within(taskCards()[0]).getByLabelText('Due (days)');
    await userEvent.clear(due);
    await pasteInto(due, '-2');
    expect(taskCards()[0]).toHaveTextContent('2 days before joining');

    await userEvent.click(within(editor()).getByRole('button', { name: /Add task/ }));
    await pasteInto(within(taskCards()[1]).getByLabelText('Title'), 'Week-one survey');
    // The survey goes first.
    await userEvent.click(within(editor()).getByRole('button', { name: 'Move task 2 up' }));
    expect(within(taskCards()[0]).getByLabelText('Title')).toHaveValue('Week-one survey');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));

    await waitFor(() =>
      expect(writes[0].body).toEqual({
        name: 'Engineering onboarding',
        kind: 'onboarding',
        tasks: [
          { title: 'Week-one survey', instructions: '', assignee: { kind: 'admin', userId: null }, dueOffsetDays: 0, type: 'task', questions: [], link: null },
          { title: 'Set up the laptop', instructions: '', assignee: { kind: 'admin', userId: null }, dueOffsetDays: -2, type: 'task', questions: [], link: null },
        ],
      })
    );
    expect(await screen.findByText('Saved Engineering onboarding')).toBeInTheDocument();
    expect(await screen.findByText('Engineering onboarding', { selector: '.ant-card-head-title span' })).toBeInTheDocument();
  });

  it("edits a template, keeping its task keys, and shows the server's reasons", async () => {
    renderPage();
    await screen.findByText('Interns');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Interns' }));
    await waitFor(() => expect(editor()).toBeTruthy());
    expect(within(taskCards()[0]).getByLabelText('Title')).toHaveValue('Meet the mentor');

    refuse = { status: 400, body: { success: false, error: { message: 'Validation failed', details: { fieldErrors: { name: ['There is already a template with this name'] } } } } };
    const name = within(editor()).getByLabelText('Name');
    await userEvent.clear(name);
    await pasteInto(name, 'Standard onboarding');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));
    expect(await within(editor()).findByText('There is already a template with this name')).toBeInTheDocument();
    expect(writes[0]).toMatchObject({ method: 'PUT', path: '/checklist-templates/t2' });
    expect(writes[0].body).not.toHaveProperty('kind');
    expect((writes[0].body as { tasks: { key: string }[] }).tasks[0].key).toBe('k4');

    refuse = { status: 400, body: { success: false, error: { message: 'Validation failed', details: { fieldErrors: { tasks: ['Task 1: that person isn’t an active member of your organization'] } } } } };
    await userEvent.click(within(editor()).getByRole('button', { name: 'Save template' }));
    expect(await within(editor()).findByText('Task 1: that person isn’t an active member of your organization')).toBeInTheDocument();
  });
});
