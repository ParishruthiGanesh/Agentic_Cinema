"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, inputCls } from "@/components/family";
import { useResource } from "@/lib/hooks";

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void; renderButton: (el: HTMLElement, o: Record<string, string | number>) => void } } };
  }
}

/** Sign in with an email and password, or with Google when a client id is configured. */
export default function SignInPage() {
  const { account, signIn, register, google } = useAuth();
  const router = useRouter();
  const config = useResource(() => api.authConfig(), []);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const gButton = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (account) router.replace("/");
  }, [account, router]);

  // Google Identity Services button (only when GOOGLE_OAUTH_CLIENT_ID is set on the API).
  useEffect(() => {
    const clientId = config.data?.googleClientId;
    if (!clientId || !gButton.current) return;
    const render = () => {
      if (!window.google || !gButton.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (r) => {
          setError(undefined);
          try {
            await google(r.credential);
          } catch (e) {
            setError((e as Error).message);
          }
        },
      });
      window.google.accounts.id.renderButton(gButton.current, { theme: "outline", size: "large", width: 320, text: "continue_with" });
    };
    if (window.google) render();
    else {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [config.data?.googleClientId, google]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (mode === "signin") await signIn(email, password);
      else await register(email, password, name);
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="text-3xl font-semibold">{mode === "signin" ? "Sign in" : "Create an account"}</h1>
      <p className="mt-1 text-[#7a7264]">One account per family or clinic. Your child's profile, photos and stories stay private to it.</p>
      <Card className="mt-6">
        <form onSubmit={submit} className="grid gap-4">
          {mode === "register" && <Field label="Your name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>}
          <Field label="Email"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
          <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined}><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "signin" ? "current-password" : "new-password"} /></Field>
          {error && <div className="text-sm text-[#a13333]">{error}</div>}
          <Button type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
        </form>
        {config.data?.googleClientId ? (
          <div className="mt-5 border-t border-[#eee9dd] pt-5">
            <div className="mb-2 text-center text-xs text-[#7a7264]">or</div>
            <div ref={gButton} className="flex justify-center" />
          </div>
        ) : (
          <div className="mt-4 text-xs text-[#a59d8c]">Google sign-in appears here when the server has a Google client id configured.</div>
        )}
      </Card>
      <div className="mt-4 text-center text-sm text-[#7a7264]">
        {mode === "signin" ? (
          <>New here? <button className="font-semibold text-[#2f7d4f] hover:underline" onClick={() => setMode("register")}>Create an account</button></>
        ) : (
          <>Already have an account? <button className="font-semibold text-[#2f7d4f] hover:underline" onClick={() => setMode("signin")}>Sign in</button></>
        )}
      </div>
    </div>
  );
}
