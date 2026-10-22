import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { authApi, type LoginInput, type RegisterInput, type User } from '../api/auth';

interface AuthValue {
  user: User | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<User | null> => {
      try {
        return (await authApi.me()).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const login = useCallback(
    async (input: LoginInput) => {
      const { user } = await authApi.login(input);
      qc.setQueryData(['me'], user);
      return user;
    },
    [qc],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const { user } = await authApi.register(input);
      qc.setQueryData(['me'], user);
      return user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({ user: data ?? null, isLoading, login, register, logout }),
    [data, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}