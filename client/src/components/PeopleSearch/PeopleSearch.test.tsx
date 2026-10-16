import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '../../test/setup';
import { API_BASE_URL } from '../../services/api';
import { makeTestStore } from '../../test/makeTestStore';
import type { Person, PersonProfile, PersonSearchResult } from '../../types/people';
import { PeopleSearch } from './PeopleSearch';

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, jobTitle: null, departmentName: null, avatarUrl: null, role: 'ORG_USER', reportsTo: null, joiningDate: '2025-01-01', ...extra };
}

const MAYA = person('m1', 'Maya Shah', { jobTitle: 'Engineering Manager' });
const IVY = person('i1', 'Ivy Mehta', { jobTitle: 'Frontend Engineer', departmentName: 'Engineering', reportsTo: 'm1' });
const RAJ = person('r1', 'Raj Patel', { jobTitle: 'Designer', reportsTo: 'm1' });

const PROFILES: Record<string, PersonProfile> = {
  i1: { ...IVY, email: 'ivy@acme.com', presence: 'in', wfh: true, manager: MAYA, directReports: [], introduction: { about: 'Frontend dev from Pune', hobbies: '', lovesAboutJob: '' }, birthday: '03-12', praiseCount: 4, recentPraise: [{ id: 'p1', badge: 'teamwork', fromName: 'Raj Patel', message: 'Thanks for the late-night fix!', createdAt: new Date().toISOString() }] },
  m1: { ...MAYA, email: 'maya@acme.com', presence: 'on_leave', wfh: false, manager: null, directReports: [IVY, RAJ], introduction: { about: '', hobbies: '', lovesAboutJob: '' }, birthday: null, praiseCount: 0, recentPraise: [] },
};

let queries: string[];

beforeEach(() => {
  queries = [];
  server.use(
    http.get(`${API_BASE_URL}/people/search`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')!;
      queries.push(q);
      const all: PersonSearchResult[] = [
        { ...IVY, email: 'ivy@acme.com', presence: 'in', wfh: true },
        { ...MAYA, email: 'maya@acme.com', presence: 'on_leave', wfh: false },
      ];
      return HttpResponse.json({ success: true, data: all.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.jobTitle ?? '').toLowerCase().includes(q.toLowerCase())) });
    }),
    http.get(`${API_BASE_URL}/people/:id`, ({ params }) => {
      const p = PROFILES[params.id as string];
      return p ? HttpResponse.json({ success: true, data: p }) : HttpResponse.json({ success: false, error: { message: 'Person not found' } }, { status: 404 });
    })
  );
});

function renderSearch() {
  render(
    <Provider store={makeTestStore()}>
      <PeopleSearch />
    </Provider>
  );
}

describe('PeopleSearch', () => {
  it('finds employees as you type, with where they are today', async () => {
    renderSearch();
    await userEvent.type(screen.getByLabelText('Search employees'), 'eng');
    const results = await screen.findAllByTestId('search-result');
    expect(results.map((r) => within(r).getByText(/Ivy|Maya/).textContent)).toEqual(['Ivy Mehta', 'Maya Shah']);
    expect(within(results[0]).getByText('Frontend Engineer · Engineering')).toBeInTheDocument();
    expect(within(results[0]).getByText('In')).toBeInTheDocument();
    expect(within(results[0]).getByText('WFH')).toBeInTheDocument();
    expect(within(results[1]).getByText('On leave')).toBeInTheDocument();
    // Debounced: one search for the whole word, not one per letter.
    expect(queries).toEqual(['eng']);
  });

  it('says when nobody matches', async () => {
    renderSearch();
    await userEvent.type(screen.getByLabelText('Search employees'), 'zzz');
    expect(await screen.findByText('No one matches “zzz”')).toBeInTheDocument();
  });

  it('opens the profile, and walks to the manager and back down', async () => {
    renderSearch();
    await userEvent.type(screen.getByLabelText('Search employees'), 'ivy');
    await userEvent.click(await screen.findByText('Ivy Mehta'));

    const profile = await screen.findByTestId('person-profile');
    expect(within(profile).getByText('Ivy Mehta')).toBeInTheDocument();
    expect(within(profile).getByRole('link', { name: /ivy@acme.com/ })).toHaveAttribute('href', 'mailto:ivy@acme.com');
    expect(within(profile).getByText('Frontend dev from Pune')).toBeInTheDocument();
    // Day and month only.
    expect(within(profile).getByText('12 March')).toBeInTheDocument();
    expect(within(profile).getByText('Praise received · 4')).toBeInTheDocument();
    const praise = within(profile).getByRole('list', { name: 'Praise received' });
    expect(praise).toHaveTextContent('🤝 Teamwork');
    expect(praise).toHaveTextContent(/from Raj Patel/);
    expect(praise).toHaveTextContent('Thanks for the late-night fix!');
    expect(screen.getByLabelText('Search employees')).toHaveValue('');

    await userEvent.click(within(profile).getByRole('button', { name: 'Open Maya Shah' }));
    await waitFor(() => expect(screen.getByTestId('person-profile')).toHaveTextContent('maya@acme.com'));
    const maya = screen.getByTestId('person-profile');
    expect(within(maya).getByText('No manager set')).toBeInTheDocument();
    expect(within(maya).queryByText('Birthday')).not.toBeInTheDocument();
    expect(within(maya).getByText('No praise yet')).toBeInTheDocument();
    expect(within(maya).getByText('Direct reports · 2')).toBeInTheDocument();
    expect(within(maya).getByText("Maya hasn't written an introduction yet.")).toBeInTheDocument();
    await userEvent.click(within(maya).getByRole('button', { name: 'Open Raj Patel' }));
    expect(await screen.findByText('Person not found')).toBeInTheDocument();
  });

  it('jumps to the search with Ctrl/⌘ + K', async () => {
    renderSearch();
    expect(screen.getByLabelText('Search employees')).not.toHaveFocus();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByLabelText('Search employees')).toHaveFocus();
    (screen.getByLabelText('Search employees') as HTMLInputElement).blur();
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(screen.getByLabelText('Search employees')).toHaveFocus();
  });
});
