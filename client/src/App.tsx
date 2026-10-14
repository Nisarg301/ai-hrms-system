import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { useAppDispatch } from './hooks/store';
import { AppRouter } from './routes/AppRouter';
import { setOnAuthFailure, setOnPlanExpired } from './services/api';
import { store } from './store';
import { planLapsed, sessionCleared } from './store/auth/authSlice';
import { bootstrapSession } from './store/auth/authThunks';
import { ThemeProvider } from './theme/ThemeContext';

function AppBoot() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Restore the session on load: the in-memory access token is gone after a
    // reload, but the httpOnly refresh cookie survives.
    void dispatch(bootstrapSession());
  }, [dispatch]);

  useEffect(() => {
    // Lets the axios interceptor clear the session without importing the store
    // (which would be circular).
    setOnAuthFailure(() => {
      dispatch(sessionCleared());
    });
    // A 402 means the plan ran out mid-session; PlanGate reacts to the change.
    setOnPlanExpired(() => {
      dispatch(planLapsed());
    });
    return () => {
      setOnAuthFailure(null);
      setOnPlanExpired(null);
    };
  }, [dispatch]);

  return <AppRouter />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Provider store={store}>
        <ErrorBoundary>
          <BrowserRouter>
            <AppBoot />
          </BrowserRouter>
        </ErrorBoundary>
      </Provider>
    </ThemeProvider>
  );
}

