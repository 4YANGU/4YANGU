import { useContext } from 'react';
import { AuthContext } from './authContext';

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Authentication provider missing.');
  return value;
}
