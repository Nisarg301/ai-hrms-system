import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../../services/api';
import { activeSubscription } from '../../test/fixtures';
import { makeTestStore } from '../../test/makeTestStore';
import { server } from '../../test/setup';
import type { AiAction, AiChatMessage, AiModuleInfo } from '../../types/ai';
import { AiAssistant } from './AiAssistant';

// The Performance and Profile assistants' cards (docs/AI_ME_ASSISTANTS.md, sections 6 and 7).

const MODULES: AiModuleInfo[] = [
  { key: 'performance', title: 'Performance assistant', intro: 'Goals and reviews.', starters: [{ label: 'Write self review', toolCall: { name: 'write_review', args: {} } }] },
  { key: 'my-profile', title: 'Profile assistant', intro: 'Your profile.', starters: [{ label: 'Edit introduction', toolCall: { name: 'update_introduction', args: {}, form: true } }] },
];

const QUESTIONS = [
  { id: 'q1', text: 'What went well this period?' },
  { id: 'q2', text: 'What could have gone better?' },
  { id: 'q3', text: 'What do you want to focus on next?' },
];

const REVIEW: AiAction = {
  id: 'r1',
  tool: 'write_review',
  status: 'pending',
  resultText: null,
  card: {
    title: 'Your H2 2026 self review',
    tone: 'default',
    rows: [...QUESTIONS.map((q) => ({ label: q.text, value: q.id === 'q2' ? '—' : 'An answer' })), { label: 'Rating', value: '4 · Exceeds expectations' }],
    confirmLabel: 'Save draft',
    form: { kind: 'review', mode: 'update', values: { answers: { q1: 'Shipped onboarding', q2: '', q3: 'Hiring' }, rating: 4, submitNow: false }, questions: QUESTIONS },
  },
};

const INTRO: AiAction = {
  id: 'i1',
  tool: 'update_introduction',
  status: 'pending',
  resultText: null,
  card: {
    title: 'Update your introduction',
    tone: 'default',
    rows: [{ label: 'My hobbies', value: 'Reading' }],
    confirmLabel: 'Save',
    form: { kind: 'introduction', mode: 'update', values: { about: 'Backend engineer', hobbies: 'Reading', lovesAboutJob: '' } },
    incomplete: true,
  },
};

const answer = (message: Partial<AiChatMessage>): AiChatMessage => ({ role: 'assistant', text: '', result: null, action: null, createdAt: '2026-10-22T10:00:00.000Z', ...message });
const ok = (data: unknown) => HttpResponse.json({ success: true, data });

function renderAt(path: string, action: AiAction, onConfirm: (body: unknown) => void, reloads: Record<string, number>) {
  const counted = (url: string, data: unknown) =>
    http.get(`${API_BASE_URL}${url}`, () => {
      reloads[url] = (reloads[url] ?? 0) + 1;
      return ok(data);
    });
  server.use(
    http.get(`${API_BASE_URL}/ai/modules`, () => ok(MODULES)),
    http.get(`${API_BASE_URL}/ai/conversations`, () => ok([])),
    counted('/goals/mine', []),
    counted('/goals/team', []),
    counted('/reviews/mine', []),
    counted('/reviews/to-write', []),
    counted('/me/introduction', { about: '', hobbies: '', lovesAboutJob: '' }),
    counted('/me/profile-details', { dateOfBirth: null }),
    http.post(`${API_BASE_URL}/ai/chat`, () =>
      new HttpResponse(`event: message\ndata: ${JSON.stringify({ message: answer({ action }) })}\n\nevent: done\ndata: {"conversationId":"c1"}\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    ),
    http.post(`${API_BASE_URL}/ai/actions/${action.id}/confirm`, async ({ request }) => {
      onConfirm(await request.json());
      return ok({ action: { ...action, status: 'confirmed', resultText: 'Saved' }, message: answer({ result: { text: '✅ Saved.' } }), secrets: [] });
    })
  );
  const store = makeTestStore({
    auth: {
      user: {
        id: 'u2',
        name: 'Priya Shah',
        email: 'priya@acme.com',
        role: 'ORG_USER',
        organizationId: 'o1',
        roleId: 'r1',
        mustChangePassword: false,
        permissions: { scope: 'all' },
        subscription: activeSubscription('professional'),
      },
      status: 'authenticated',
      bootstrapped: true,
      error: null,
      resetToken: null,
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AiAssistant />
      </MemoryRouter>
    </Provider>
  );
}

describe('AiAssistant on the Performance tab', () => {
  it('saves a draft by default, needs every answer to submit, and reloads goals and reviews', async () => {
    let confirmed: unknown = null;
    const reloads: Record<string, number> = {};
    renderAt('/me/performance?section=reviews', REVIEW, (body) => (confirmed = body), reloads);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the performance assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'Write self review' }));
    const card = await screen.findByTestId('ai-confirm-card');
    expect(within(card).getByRole('button', { name: 'Save draft' })).toBeInTheDocument();

    // Submit now on: the button says so, and an empty answer holds it back.
    await user.click(within(card).getByRole('button', { name: /Edit/ }));
    await user.click(within(card).getByLabelText('Submit now'));
    await user.click(within(card).getByRole('button', { name: 'Submit review' }));
    expect(await within(card).findByText('Answer this question to submit')).toBeInTheDocument();
    expect(confirmed).toBeNull();

    await user.click(within(card).getByLabelText('What could have gone better?'));
    await user.paste('Hiring was slow');
    await user.click(within(card).getByRole('button', { name: 'Submit review' }));
    await waitFor(() => expect(confirmed).toEqual({ values: { answers: { q1: 'Shipped onboarding', q2: 'Hiring was slow', q3: 'Hiring' }, rating: 4, submitNow: true } }));
    expect(await within(card).findByText('Done')).toBeInTheDocument();
    await waitFor(() => expect(reloads).toMatchObject({ '/goals/mine': 1, '/goals/team': 1, '/reviews/mine': 1, '/reviews/to-write': 1 }));
  }, 60_000);
});

describe('AiAssistant on the Profile tab', () => {
  it('edits the introduction on the card and reloads it and the date of birth', async () => {
    let confirmed: unknown = null;
    const reloads: Record<string, number> = {};
    renderAt('/me/profile', INTRO, (body) => (confirmed = body), reloads);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open the profile assistant/i }));
    await user.click(await screen.findByRole('button', { name: 'Edit introduction' }));
    const card = await screen.findByTestId('ai-confirm-card');
    const hobbies = within(card).getByLabelText('My hobbies');
    await user.clear(hobbies);
    await user.type(hobbies, 'Cycling');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(confirmed).toEqual({ values: { about: 'Backend engineer', hobbies: 'Cycling', lovesAboutJob: '' } }));
    await waitFor(() => expect(reloads).toMatchObject({ '/me/introduction': 1, '/me/profile-details': 1 }));
  }, 60_000);
});
