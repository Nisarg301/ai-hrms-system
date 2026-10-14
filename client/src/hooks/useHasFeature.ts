import { useCallback } from 'react';
import { PLAN_FEATURES, type PlanFeature } from '../constants/modules';
import { selectSubscription } from '../store/auth/authSelectors';
import type { Subscription } from '../types/subscription';
import { useAppSelector } from './store';

/** The plan's features: as the server sent them, or (an older session) worked out from the plan. */
export function planFeatures(subscription: Subscription | null | undefined): readonly PlanFeature[] {
  if (!subscription) return [];
  if (subscription.features) return subscription.features;
  return subscription.active && subscription.planType ? PLAN_FEATURES[subscription.planType] : [];
}

/** Returns a stable `hasFeature(feature)` predicate for the current organization's plan. */
export function useHasFeature(): (feature: PlanFeature) => boolean {
  const subscription = useAppSelector(selectSubscription);
  return useCallback((feature: PlanFeature) => planFeatures(subscription).includes(feature), [subscription]);
}
