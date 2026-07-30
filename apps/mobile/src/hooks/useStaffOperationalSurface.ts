import { useAuth } from './useAuth';

/** Staff operational screens: require auth and a linked staff profile. */
export function useStaffOperationalSurface(): boolean {
  const { token, hasStaffProfile } = useAuth();
  return !!token && hasStaffProfile;
}
