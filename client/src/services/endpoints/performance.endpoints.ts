import { callApiServices } from '../callApiServices';
import type {
  CheckInPayload,
  Goal,
  GoalDetail,
  GoalPayload,
  GoalStatus,
  MyReviewRow,
  ReviewDetail,
  ReviewPartName,
  ReviewPartPayload,
  ReviewToWriteRow,
} from '../../types/performance';

export function listMyGoalsRequest() {
  return callApiServices<Goal[]>('/goals/mine', 'get', true);
}

/** My direct reports' goals, or one person's (as their manager or an admin). */
export function listTeamGoalsRequest(params: { ownerId?: string; status?: GoalStatus } = {}) {
  return callApiServices<Goal[]>('/goals/team', 'get', true, params);
}

export function getGoalRequest(id: string) {
  return callApiServices<GoalDetail>(`/goals/${id}`, 'get', true);
}

export function createGoalRequest(payload: GoalPayload) {
  return callApiServices<GoalDetail>('/goals', 'post', true, payload);
}

export function updateGoalRequest(id: string, payload: Omit<GoalPayload, 'ownerId'>) {
  return callApiServices<GoalDetail>(`/goals/${id}`, 'put', true, payload);
}

export function deleteGoalRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/goals/${id}`, 'delete', true);
}

export function checkInRequest(id: string, payload: CheckInPayload) {
  return callApiServices<GoalDetail>(`/goals/${id}/check-ins`, 'post', true, payload);
}

// ---------------------------------------------------------------- reviews

export function listMyReviewsRequest() {
  return callApiServices<MyReviewRow[]>('/reviews/mine', 'get', true);
}

export function listReviewsToWriteRequest() {
  return callApiServices<ReviewToWriteRow[]>('/reviews/to-write', 'get', true);
}

export function getReviewRequest(id: string) {
  return callApiServices<ReviewDetail>(`/reviews/${id}`, 'get', true);
}

/** Saves a draft of one part, or submits it. */
export function writeReviewPartRequest(id: string, part: ReviewPartName, payload: ReviewPartPayload, submit: boolean) {
  return submit
    ? callApiServices<ReviewDetail>(`/reviews/${id}/${part}/submit`, 'post', true, payload)
    : callApiServices<ReviewDetail>(`/reviews/${id}/${part}`, 'put', true, payload);
}
