import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import BrandLogo from './components/BrandLogo';

const MarketingPage = lazy(() => import('./pages/MarketingPage'));
const FounderDashboard = lazy(() => import('./pages/FounderDashboard'));
const StoreDashboard = lazy(() => import('./pages/StoreDashboard'));

function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'founder' ? '/founder' : '/owner'} replace />;
}

export default function PlatformApp() {
  return <AuthProvider><BrowserRouter><Suspense fallback={<div className="auth-loader"><BrandLogo /><p>Opening your workspace…</p></div>}><Routes>
    <Route path="/" element={<MarketingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/founder" element={<ProtectedRoute role="founder"><FounderDashboard /></ProtectedRoute>} />
    <Route path="/owner" element={<ProtectedRoute role="owner"><StoreDashboard /></ProtectedRoute>} />
    <Route path="/manage/:storeId" element={<ProtectedRoute role="founder"><StoreDashboard /></ProtectedRoute>} />
    <Route path="/app" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></BrowserRouter></AuthProvider>;
}
