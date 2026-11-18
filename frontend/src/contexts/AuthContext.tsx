// Auth context - manages authentication state.
// Tokens are in HttpOnly cookies (not accessible to JS).
// This context tracks login state for UI purposes only.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { authService } from "@/services/auth";
import type { User } from "@/types";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    fullName: string,
    organizationName: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const currentUser = await authService.getMe();
      setUser(currentUser);
    } catch (err: any) {
      // Only 401/403 proves the session is gone. Transient failures (429 rate
      // limit, network) must NOT log an authenticated user out — keep state.
      const status = err?.status;
      if (status === 401 || status === 403) {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(
    async (email: string, password: string) => {
      await authService.login({ email, password });
      await checkAuth();
    },
    [checkAuth]
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      organizationName: string
    ) => {
      await authService.register({
        email,
        password,
        full_name: fullName,
        organization_name: organizationName,
      });
      await checkAuth();
    },
    [checkAuth]
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // ignore errors during logout
    }
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    await authService.refresh();
    await checkAuth();
  }, [checkAuth]);

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refresh,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
