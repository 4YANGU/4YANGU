import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from './BrandLogo';

export default function ProtectedRoute({ role, children }: { role?: 'founder' | 'owner'; children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="auth-loader"><BrandLogo /><div className="loading-line" /></div>;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (role && profile.role !== role) return <Navigate to={profile.role === 'founder' ? '/founder' : '/owner'} replace />;
  return children;
}
