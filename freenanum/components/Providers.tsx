'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from '@/lib/supabase';
import { rpc } from '@/lib/api';
import type { Bootstrap, Me } from '@/lib/types';
import QuickStart from './QuickStart';

interface AppState {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  me: Me | null;
  boot: Bootstrap | null;
  refreshMe: () => Promise<Me | null>;
  /** Opens the no-sign-up quick start if needed. Resolves true once the visitor has a nickname. */
  requireMember: () => Promise<boolean>;
  signOut: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside Providers');
  return v;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickStart, setQuickStart] = useState<((ok: boolean) => void) | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const refreshMe = useCallback(async () => {
    if (!isConfigured) return null;
    try {
      const m = await rpc<Me | null>('get_me');
      setMe(m);
      return m;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setReady(true);
      return;
    }
    const client = supabase();
    rpc<Bootstrap>('get_bootstrap').then(setBoot).catch(() => setBoot(null));
    client.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await refreshMe();
      setReady(true);
    });
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        // defer: calling Supabase inside the callback can deadlock the auth lock
        setTimeout(() => void refreshMe(), 0);
      } else {
        setMe(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshMe]);

  // keep the unread badge fresh while the app is open
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => void refreshMe(), 60_000);
    const onFocus = () => void refreshMe();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [session, refreshMe]);

  const requireMember = useCallback(async () => {
    if (!isConfigured) return false;
    if (meRef.current && !meRef.current.needs_profile) return true;
    return new Promise<boolean>((resolve) => setQuickStart(() => resolve));
  }, []);

  const finishQuickStart = useCallback(
    async (ok: boolean) => {
      if (ok) await refreshMe();
      quickStart?.(ok);
      setQuickStart(null);
    },
    [quickStart, refreshMe],
  );

  const signOut = useCallback(async () => {
    if (isConfigured) await supabase().auth.signOut();
    setMe(null);
    setSession(null);
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const value = useMemo(
    () => ({ ready, configured: isConfigured, session, me, boot, refreshMe, requireMember, signOut, toast }),
    [ready, session, me, boot, refreshMe, requireMember, signOut, toast],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {quickStart && (
        <QuickStart hasSession={Boolean(session)} onDone={() => void finishQuickStart(true)} onCancel={() => void finishQuickStart(false)} />
      )}
      {toastMsg && (
        <div className="toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </Ctx.Provider>
  );
}
