// Privacy mode and app lock.
//
// - Amounts are blurred until the user taps the eye. Hidden on every launch and again
//   whenever the app goes to the background (switching apps, locking the phone).
// - Optionally (per device, in settings): showing amounts asks for Face ID first,
//   and the whole app locks behind Face ID on launch and on every return.
//
// The Face ID check is local to the device (see deviceAuth.ts): it guards the screen.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { getSettings, saveSettings, verifyUser, type DeviceAuthSettings } from './deviceAuth';
import { useSession } from './session';

type PrivacyState = {
  hidden: boolean;
  /** Show / hide amounts. Showing may ask for Face ID; must be called from a tap. */
  toggle: () => Promise<void>;
  hide: () => void;
  /** App lock is on and the app is currently locked. */
  locked: boolean;
  /** Face ID to unlock; must be called from a tap. Resolves false if not verified. */
  unlock: () => Promise<boolean>;
  settings: DeviceAuthSettings;
  updateSettings: (s: DeviceAuthSettings) => void;
  signedInJustNow: () => void;
};

const noop = async () => {};
const Ctx = createContext<PrivacyState>({
  hidden: false,
  toggle: noop,
  hide: () => {},
  locked: false,
  unlock: async () => true,
  settings: { revealRequiresFaceId: false, appLock: false },
  updateSettings: () => {},
  signedInJustNow: () => {},
});

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [settings, setSettings] = useState<DeviceAuthSettings>(() => getSettings());
  const [hidden, setHidden] = useState(true);
  const [locked, setLocked] = useState(() => getSettings().appLock);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const hide = useCallback(() => {
    setHidden(true);
    if (settingsRef.current.appLock) setLocked(true);
  }, []);

  const toggle = useCallback(async () => {
    if (!hidden) {
      setHidden(true);
      return;
    }
    // Call straight from the tap: browsers only allow Face ID prompts from a user gesture.
    if (settingsRef.current.revealRequiresFaceId && !(await verifyUser())) return;
    setHidden(false);
  }, [hidden]);

  const unlock = useCallback(async () => {
    const ok = await verifyUser();
    if (ok) setLocked(false);
    return ok;
  }, []);

  const updateSettings = useCallback((s: DeviceAuthSettings) => {
    saveSettings(s);
    setSettings(s);
    if (!s.appLock) setLocked(false);
  }, []);

  // Called by the sign-in screen right after a password / passkey sign-in succeeds:
  // that just proved who the user is, so don't ask for Face ID again. (Restoring a
  // saved session on launch is NOT a sign-in, and stays locked.)
  const signedInJustNow = useCallback(() => setLocked(false), []);

  // Signing out resets the lock to the device setting.
  useEffect(() => {
    if (!session) setLocked(settingsRef.current.appLock);
  }, [session]);

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

  return (
    <Ctx.Provider value={{ hidden, toggle, hide, locked: locked && Boolean(session), unlock, settings, updateSettings, signedInJustNow }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePrivacy(): PrivacyState {
  return useContext(Ctx);
}
