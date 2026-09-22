import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from './BrandLogo';
export default function ProtectedRoute({ role, children }: { role?: 'founder' | 'owner'; children: React.ReactNode }) {
  const { user, profile, loading, error, refreshProfile, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <div className="auth-loader" role="status"><BrandLogo /><div className="loading-line" /><p>Restoring your workspace…</p></div>;
  if (user && error) return <div className="auth-loader"><BrandLogo /><div className="form-error">{error}</div><button className="button-primary" onClick={refreshProfile}>Try again</button><button className="secondary-button" onClick={signOut}>Sign out</button></div>;
  if (!user || !profile) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (role && role !== profile.role) return <Navigate to={profile.role === 'founder' ? '/founder' : '/owner'} replace />;
  return children;
}
