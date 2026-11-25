import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { usePrivacy } from '@/lib/privacy';
import { supabase } from '@/lib/supabase';
import { Button, colors, Screen, Text, styles } from './ui';

/** Shown instead of the app while the app lock is on and not yet unlocked with Face ID. */
export default function LockScreen() {
  const { unlock } = usePrivacy();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function tryUnlock() {
    setBusy(true);
    const ok = await unlock();
    setFailed(!ok);
    setBusy(false);
  }

  // Ask for Face ID by itself as soon as the screen is visible, so it takes one tap
  // (iOS's own "Continue") instead of two. If the browser only allows it after a tap,
  // the request quietly fails and the button below is there.
  const autoTried = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const attempt = () => {
      if (autoTried.current || document.visibilityState !== 'visible') return;
      autoTried.current = true;
      setBusy(true);
      unlock().finally(() => setBusy(false));
    };
    attempt();
    document.addEventListener('visibilitychange', attempt);
    return () => document.removeEventListener('visibilitychange', attempt);
  }, [unlock]);

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Ionicons name="lock-closed" size={48} color={colors.primary} />
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.primary, textAlign: 'center' }}>BlendIt נעולה</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>פותחים עם Face ID או עם קוד הנעילה של הטלפון.</Text>
        {failed ? <Text style={{ color: colors.negative, textAlign: 'center' }}>הזיהוי לא הצליח. נסו שוב.</Text> : null}
      </View>
      <View style={{ gap: 12 }}>
        <Button title="פתיחה עם Face ID" onPress={tryUnlock} loading={busy} />
        <Button title="התנתקות" variant="secondary" onPress={() => supabase.auth.signOut()} />
      </View>
    </Screen>
  );
}
