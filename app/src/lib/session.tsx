import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchHousehold, fetchMembers, type Household, type Member } from './api';
import { isConfigured, supabase } from './supabase';

type SessionState = {
  loading: boolean;
  session: Session | null;
  household: Household | null;
  members: Member[];
  refreshHousehold: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(isConfigured);

  const loadHousehold = useCallback(async (s: Session | null) => {
    if (!s) {
      setHousehold(null);
      setMembers([]);
      return;
    }
    try {
      const h = await fetchHousehold(s.user.id);
      setHousehold(h);
      setMembers(h ? await fetchMembers(h.id) : []);
    } catch (e) {
      console.warn('loading household failed', e);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadHousehold(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Token refreshes don't change membership; skip the extra round-trip.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: Supabase recommends not awaiting other calls inside this callback.
        setTimeout(() => loadHousehold(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadHousehold]);

  const refreshHousehold = useCallback(() => loadHousehold(session), [loadHousehold, session]);

  return (
    <Ctx.Provider value={{ loading, session, household, members, refreshHousehold }}>{children}</Ctx.Provider>
  );
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Household + current user, for screens that are only reachable once both exist. */
export function useHousehold() {
  const { household, session, members, refreshHousehold } = useSession();
  if (!household || !session) throw new Error('useHousehold requires a signed-in member');
  return { household, userId: session.user.id, members, refreshHousehold };
}
