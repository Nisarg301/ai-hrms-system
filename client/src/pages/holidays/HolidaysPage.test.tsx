import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { Holiday } from '../../types/holiday';
import HolidaysPage from './HolidaysPage';

const YEAR = dayjs().year();
let db: Holiday[];
let requests: { method: string; path: string; body?: unknown }[];

beforeEach(() => {
  db = [{ id: 'h1', name: 'Republic Day', date: `${YEAR}-01-26`, description: '' }];
  requests = [];
  server.use(
    http.get(`${API_BASE_URL}/holidays`, ({ request }) => {
      const year = new URL(request.url).searchParams.get('year')!;
      return HttpResponse.json({ success: true, data: db.filter((h) => h.date.startsWith(year)) });
    }),
    http.post(`${API_BASE_URL}/holidays`, async ({ request }) => {
      const body = (await request.json()) as Omit<Holiday, 'id'>;
      requests.push({ method: 'POST', path: '/holidays', body });
      if (db.some((h) => h.date === body.date)) {
        return HttpResponse.json(
          { success: false, error: { message: 'Validation failed', details: { fieldErrors: { date: ['There is already a holiday on this date'] } } } },
          { status: 400 }
        );
      }
      const created = { id: `h${db.length + 1}`, ...body };
      db.push(created);
      return HttpResponse.json({ success: true, data: created }, { status: 201 });
    }),
    http.put(`${API_BASE_URL}/holidays/:id`, async ({ params, request }) => {
      const body = (await request.json()) as Partial<Holiday>;
      requests.push({ method: 'PUT', path: `/holidays/${params.id}`, body });
      const h = db.find((x) => x.id === params.id)!;
      Object.assign(h, body);
      return HttpResponse.json({ success: true, data: h });
    }),
    http.delete(`${API_BASE_URL}/holidays/:id`, ({ params }) => {
      requests.push({ method: 'DELETE', path: `/holidays/${params.id}` });
      db = db.filter((h) => h.id !== params.id);
      return HttpResponse.json({ success: true, data: { id: params.id, deleted: true } });
    })
  );
});

function renderPage() {
  render(
    <Provider store={makeTestStore()}>
      <HolidaysPage />
    </Provider>
  );
}

describe('HolidaysPage', () => {
  it('adds a holiday, and shows a duplicate date on the date field', async () => {
    renderPage();
    await screen.findByText('Republic Day');
    await userEvent.click(screen.getByRole('button', { name: /add holiday/i }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Also Republic');
    await userEvent.type(within(dialog).getByLabelText('Date'), `${YEAR}-01-26{enter}`);
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    expect(await within(dialog).findByText('There is already a holiday on this date')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /add holiday/i }));
    dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Diwali');
    await userEvent.type(within(dialog).getByLabelText('Date'), `${YEAR}-11-08{enter}`);
    await userEvent.type(within(dialog).getByLabelText('Description (optional)'), 'Festival of lights');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    expect(await screen.findByText('Diwali')).toBeInTheDocument();
    expect(requests.at(-1)).toEqual({ method: 'POST', path: '/holidays', body: { name: 'Diwali', date: `${YEAR}-11-08`, description: 'Festival of lights' } });
  });

  it('edits and deletes a holiday', async () => {
    renderPage();
    await screen.findByText('Republic Day');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Republic Day' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Date')).toHaveValue(`26 Jan ${YEAR}`);
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Republic Day 🇮🇳');
    await userEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    expect(await screen.findByText('Republic Day 🇮🇳')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Republic Day 🇮🇳' }));
    const confirm = (await screen.findAllByText('Delete Republic Day 🇮🇳?')).at(-1)!.closest('.ant-modal') as HTMLElement;
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Republic Day 🇮🇳')).not.toBeInTheDocument());
    expect(requests.at(-1)).toEqual({ method: 'DELETE', path: '/holidays/h1' });
  });

  it('switches year', async () => {
    db.push({ id: 'h7', name: 'Next New Year', date: `${YEAR + 1}-01-01`, description: '' });
    renderPage();
    await screen.findByText('Republic Day');
    await userEvent.click(screen.getByRole('combobox', { name: 'Year' }));
    await userEvent.click(await screen.findByTitle(String(YEAR + 1)));
    expect(await screen.findByText('Next New Year')).toBeInTheDocument();
    expect(screen.queryByText('Republic Day')).not.toBeInTheDocument();
  });
});
