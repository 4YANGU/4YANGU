import { Component, ReactNode, lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import BrandLogo from './components/BrandLogo';

const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const FounderDashboard = lazy(() => import('./pages/FounderDashboard'));
const StoreDashboard = lazy(() => import('./pages/StoreDashboard'));

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-loader" style={{ padding: '2rem', textAlign: 'center' }}>
          <BrandLogo />
          <h2 style={{ margin: '1rem 0 0.5rem', color: '#101f30', fontSize: '1.25rem', fontWeight: 800 }}>Something interrupted this page</h2>
          <p style={{ color: '#55695d', fontSize: '14px', maxWidth: '420px', margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
            {this.state.error?.message || 'A display glitch occurred. Tap below to reload your store.'}
          </p>
          <button
            type="button"
            className="button-primary"
            style={{ margin: '0 auto' }}
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload workspace
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'founder' ? '/founder' : '/owner'} replace />;
}

export default function PlatformApp() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<div className="auth-loader"><BrandLogo /><p>Opening your workspace…</p></div>}>
            <Routes>
              <Route path="/" element={<MarketingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/founder" element={<ProtectedRoute role="founder"><FounderDashboard /></ProtectedRoute>} />
              <Route path="/owner" element={<ProtectedRoute role="owner"><StoreDashboard /></ProtectedRoute>} />
              <Route path="/manage/:storeId" element={<ProtectedRoute role="founder"><StoreDashboard /></ProtectedRoute>} />
              <Route path="/app" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
