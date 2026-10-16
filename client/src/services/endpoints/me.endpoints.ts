import { callApiServices } from '../callApiServices';
import type { Introduction, MyDetails } from '../../types/people';
import type { MyTeam } from '../../types/team';

export function getMyIntroductionRequest() {
  return callApiServices<Introduction>('/me/introduction', 'get', true);
}

export function updateMyIntroductionRequest(payload: Partial<Introduction>) {
  return callApiServices<Introduction>('/me/introduction', 'put', true, payload);
}

export function getMyTeamRequest() {
  return callApiServices<MyTeam>('/me/team', 'get', true);
}

export function getMyDetailsRequest() {
  return callApiServices<MyDetails>('/me/profile-details', 'get', true);
}

export function updateMyDetailsRequest(payload: MyDetails) {
  return callApiServices<MyDetails>('/me/profile-details', 'put', true, payload);
}
