"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, type Account } from "./api";

interface AuthCtx {
  account: Account | null | undefined;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  google: (credential: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setAccount(null);
      setLoading(false);
      return;
    }
    try {
      const r = await api.me();
      setAccount(r.account);
    } catch {
      setToken(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const accept = (r: { account: Account; token: string }) => {
    setToken(r.token);
    setAccount(r.account);
  };
  return (
    <Ctx.Provider
      value={{
        account,
        loading,
        refresh,
        signIn: async (email, password) => accept(await api.login({ email, password })),
        register: async (email, password, name) => accept(await api.register({ email, password, name })),
        google: async (credential) => accept(await api.loginWithGoogle(credential)),
        signOut: async () => {
          await api.logout().catch(() => undefined);
          setToken(null);
          setAccount(null);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
