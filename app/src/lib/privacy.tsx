// Privacy mode: amounts are blurred until the user taps the eye. Hidden on every
// launch and again whenever the app goes to the background (switching apps,
// locking the phone), so a glance over the shoulder never shows the numbers.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

type PrivacyState = { hidden: boolean; toggle: () => void; hide: () => void };

const Ctx = createContext<PrivacyState>({ hidden: false, toggle: () => {}, hide: () => {} });

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(true);
  const hide = useCallback(() => setHidden(true), []);
  const toggle = useCallback(() => setHidden((h) => !h), []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') hide();
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', hide);
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', hide);
      };
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') hide();
    });
    return () => sub.remove();
  }, [hide]);

  return <Ctx.Provider value={{ hidden, toggle, hide }}>{children}</Ctx.Provider>;
}

export function usePrivacy(): PrivacyState {
  return useContext(Ctx);
}
