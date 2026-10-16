import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { AppNotification } from '../../types/notification';
import { NotificationBell, POLL_MS } from './NotificationBell';

const NOW = new Date().toISOString();

let db: { items: AppNotification[]; countCalls: number; marked: string[]; markedAll: number };

beforeEach(() => {
  db = {
    items: [
      { id: 'n1', type: 'leave_decided', title: 'Your Paid Leave was approved', body: '6–8 Oct 2026 · “Enjoy!”', link: '/me/leave', read: false, createdAt: NOW },
      { id: 'n2', type: 'post_comment', title: 'Raj Patel commented on your post', body: 'Great work!', link: '/home', read: false, createdAt: NOW },
      { id: 'n3', type: 'announcement', title: 'New announcement: Town hall', body: '', link: '/home', read: true, createdAt: NOW },
    ],
    countCalls: 0,
    marked: [],
    markedAll: 0,
  };
  const unread = () => db.items.filter((n) => !n.read).length;
  const ok = (data: unknown) => HttpResponse.json({ success: true, data });
  server.use(
    http.get(`${API_BASE_URL}/notifications/unread-count`, () => {
      db.countCalls += 1;
      return ok({ count: unread() });
    }),
    http.get(`${API_BASE_URL}/notifications`, () => ok({ items: db.items, unreadCount: unread() })),
    http.post(`${API_BASE_URL}/notifications/read-all`, () => {
      db.markedAll += 1;
      db.items.forEach((n) => (n.read = true));
      return ok({ updated: 2 });
    }),
    http.post(`${API_BASE_URL}/notifications/:id/read`, ({ params }) => {
      db.marked.push(params.id as string);
      const n = db.items.find((x) => x.id === params.id)!;
      n.read = true;
      return ok(n);
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderBell() {
  render(
    <Provider store={makeTestStore()}>
      <MemoryRouter initialEntries={['/home']}>
        <NotificationBell />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe('NotificationBell', () => {
  it('shows the unread count and lists notifications when opened', async () => {
    renderBell();
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    await userEvent.click(bell);
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const rows = within(list).getAllByTestId('notification');
    expect(rows.map((r) => r.getAttribute('data-read'))).toEqual(['false', 'false', 'true']);
    expect(within(rows[0]).getByText('Your Paid Leave was approved')).toBeInTheDocument();
    expect(within(rows[0]).getByText('6–8 Oct 2026 · “Enjoy!”')).toBeInTheDocument();
    expect(within(rows[0]).getByLabelText('Unread')).toBeInTheDocument();
    expect(within(rows[2]).queryByLabelText('Unread')).not.toBeInTheDocument();
  });

  it('marks one read and opens where it points', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByText('Your Paid Leave was approved'));
    expect(screen.getByTestId('where')).toHaveTextContent('/me/leave');
    await waitFor(() => expect(db.marked).toEqual(['n1']));
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();

    // An already-read one just navigates.
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await userEvent.click(await screen.findByText('New announcement: Town hall'));
    expect(screen.getByTestId('where')).toHaveTextContent('/home');
    expect(db.marked).toEqual(['n1']);
  });

  it('marks all as read', async () => {
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(db.markedAll).toBe(1);
    expect(screen.getAllByTestId('notification').every((r) => r.getAttribute('data-read') === 'true')).toBe(true);
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('says when there is nothing', async () => {
    db.items = [];
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('refreshes the count every minute', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    renderBell();
    await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(db.countCalls).toBe(1);
    db.items.push({ id: 'n4', type: 'announcement', title: 'Another', body: '', link: '/home', read: false, createdAt: NOW });
    act(() => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
    expect(db.countCalls).toBe(2);
  });
});
