import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import StoreStartupLoader from './StoreStartupLoader';
export default function ProtectedRoute({ role, children }: { role?: 'founder' | 'owner'; children: React.ReactNode }) {
  const { user, profile, loading, error, refreshProfile, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <StoreStartupLoader message="Restoring your workspace…" />;
  if (user && error) return <div className="auth-loader"><div className="form-error">{error}</div><button className="button-primary" onClick={refreshProfile}>Try again</button><button className="secondary-button" onClick={signOut}>Sign out</button></div>;
  if (!user || !profile) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (role && role !== profile.role) return <Navigate to={profile.role === 'founder' ? '/founder' : '/owner'} replace />;
  return children;
}
