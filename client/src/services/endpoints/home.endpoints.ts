import { callApiServices } from '../callApiServices';
import type { HomeSummary } from '../../types/home';

export function getHomeSummaryRequest() {
  return callApiServices<HomeSummary>('/home/summary', 'get', true);
}
