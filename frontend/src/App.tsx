import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { Overview } from './components/dashboard/Overview';
import { KillSwitchPanel } from './components/controls/KillSwitchPanel';
import { useDashboardStore } from './store/dashboardStore';

function ErrorFallback({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return (
    <div className="flex items-center justify-center h-[calc(100vh-56px)]">
      <div className="text-center max-w-md p-6">
        <h2 className="text-xl font-bold text-loss mb-2">Dashboard Error</h2>
        <p className="text-sm text-muted mb-4">{message}</p>
        <button onClick={resetErrorBoundary} className="btn-primary">
          Retry
        </button>
      </div>
    </div>
  );
}

const REFRESH_INTERVAL_S = 15;

/** Placeholder pages for routes not yet built */
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-56px)]">
      <div className="text-center">
        <h2 className="text-xl font-bold text-text mb-2">{title}</h2>
        <p className="text-sm text-muted">Coming soon</p>
      </div>
    </div>
  );
}

export default function App() {
  const fetchData = useDashboardStore((s) => s.fetchData);
  const tickCountdown = useDashboardStore((s) => s.tickCountdown);
  const setCountdown = useDashboardStore((s) => s.setCountdown);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Initial fetch + auto-refresh countdown
  useEffect(() => {
    fetchData();

    timerRef.current = setInterval(() => {
      const remaining = tickCountdown();
      if (remaining <= 0) {
        setCountdown(REFRESH_INTERVAL_S);
        fetchData();
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData, tickCountdown, setCountdown]);

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-5" id="main-content">
            <ErrorBoundary FallbackComponent={ErrorFallback}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/trading" element={<PlaceholderPage title="Trading" />} />
                <Route path="/strategy" element={<PlaceholderPage title="Strategy" />} />
                <Route path="/risk" element={<KillSwitchPanel />} />
                <Route path="/reports" element={<PlaceholderPage title="Reports" />} />
                <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
              </Routes>
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
