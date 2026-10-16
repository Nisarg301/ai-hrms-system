import { callApiServices } from '../callApiServices';
import type { IntroductionCard, Person, PersonProfile, PersonSearchResult } from '../../types/people';

export function listPeopleRequest() {
  return callApiServices<Person[]>('/people', 'get', true);
}

export function listIntroductionsRequest() {
  return callApiServices<IntroductionCard[]>('/people/introductions', 'get', true);
}

export function searchPeopleRequest(q: string) {
  return callApiServices<PersonSearchResult[]>('/people/search', 'get', true, { q });
}

export function getPersonProfileRequest(id: string) {
  return callApiServices<PersonProfile>(`/people/${id}`, 'get', true);
}
