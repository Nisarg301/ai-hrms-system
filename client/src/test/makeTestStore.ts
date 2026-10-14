import { configureStore } from '@reduxjs/toolkit';
import { rootReducer, type RootState } from '../store';

/**
 * A fresh store with every app slice, optionally seeded. Components pull in
 * modals and selectors from other slices (e.g. TaskFormModal reads projects and
 * employees), so a hand-picked reducer list breaks whenever a slice is added.
 */
export function makeTestStore(preloadedState?: Partial<RootState>) {
  return configureStore({ reducer: rootReducer, preloadedState });
}
