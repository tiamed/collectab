import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import { getCachedUser, setCachedUser } from '@/lib/dataCache';

export function useAuth(ready: boolean, initialUser: api.User | null = null) {
  const [user, setUser] = useState<api.User | null>(initialUser);
  const [loading, setLoading] = useState(!initialUser);

  useEffect(() => {
    if (!ready) return;

    if (!api.isLoggedIn()) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Prefer already-bootstrapped cache; otherwise try again (cache should be loaded).
    const cached = initialUser || getCachedUser();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }

    api.getMe().then((u) => {
      if (u) {
        setUser(u);
        setCachedUser(u);
      } else if (!api.isLoggedIn()) {
        // Auth actually invalidated (a 401 cleared the token). Network
        // failures return null from getMe but keep the token — retain cache.
        setUser(null);
        setCachedUser(null);
      }
      setLoading(false);
    });
  }, [ready, initialUser]);

  useEffect(() => {
    if (!ready) return;
    return api.subscribeSession((loggedIn) => {
      if (loggedIn) {
        void api.getMe().then((u) => {
          if (!u) return;
          setUser(u);
          setCachedUser(u);
        });
      } else {
        setUser(null);
        setCachedUser(null);
      }
    });
  }, [ready]);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setCachedUser(user);
    setUser(user);
    return user;
  }, []);

  const register = useCallback(async (email: string, password: string, name: string, inviteCode?: string) => {
    const { user } = await api.register(email, password, name, inviteCode);
    setCachedUser(user);
    setUser(user);
    return user;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await api.getMe();
    if (u) {
      setUser(u);
      setCachedUser(u);
    }
    return u;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const { user } = await api.loginWithGoogle();
    setCachedUser(user);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setCachedUser(null);
    setUser(null);
  }, []);

  return { user, loading, login, register, loginWithGoogle, logout, refreshUser, isLoggedIn: !!user };
}
