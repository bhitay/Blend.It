import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, Card, Chips, colors, ErrorText, Field, Loading, Screen, Text, styles } from '@/components/ui';
import { cancelJoinRequest, createHousehold, fetchMyJoinRequest, requestJoin, type MyJoinRequest } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const POLL_MS = 8000;

export default function Onboarding() {
  const { refreshHousehold } = useSession();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [myName, setMyName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<MyJoinRequest | null | undefined>(undefined);

  const checkRequest = useCallback(async () => {
    const r = await fetchMyJoinRequest().catch(() => null);
    setRequest(r);
    // Approved: this user is now a member, load the household (the navigator moves on).
    if (r?.status === 'approved') await refreshHousehold();
    return r;
  }, [refreshHousehold]);

  useEffect(() => {
    checkRequest();
  }, [checkRequest]);

  // While waiting, check every few seconds and whenever the app comes back to the screen.
  useEffect(() => {
    if (request?.status !== 'pending') return;
    const timer = setInterval(checkRequest, POLL_MS);
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') checkRequest();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [request?.status, checkRequest]);

  async function submit() {
    setError(null);
    if (!myName.trim()) return setError('איך לקרוא לך?');
    if (mode === 'create' && !householdName.trim()) return setError('תנו שם למשק הבית');
    if (mode === 'join' && !code.trim()) return setError('הזינו את קוד ההזמנה');
    setBusy(true);
    try {
      if (mode === 'create') {
        await createHousehold(householdName.trim(), myName.trim());
        await refreshHousehold();
      } else {
        const result = await requestJoin(code.trim(), myName.trim());
        if (result === 'member') await refreshHousehold();
        else await checkRequest();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelJoinRequest();
      await checkRequest();
    } finally {
      setBusy(false);
    }
  }

  if (request === undefined) return <Loading />;

  if (request?.status === 'pending') {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', gap: 14, paddingVertical: 28 }}>
          <Ionicons name="hourglass-outline" size={40} color={colors.primary} />
          <Text style={{ fontSize: 20, fontWeight: '800', textAlign: 'center' }}>הבקשה נשלחה</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            מנהל משק הבית צריך לאשר אותה מתוך האפליקציה שלו (הגדרות ← בקשות הצטרפות). ברגע שיאשר, תיכנסו לכאן
            אוטומטית.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={colors.muted} />
            <Text style={styles.muted}>ממתין לאישור…</Text>
          </View>
        </Card>
        <Button title="בדיקה עכשיו" variant="secondary" onPress={() => checkRequest()} />
        <Button title="ביטול הבקשה" variant="danger" onPress={cancel} loading={busy} />
        <Button title="התנתקות" variant="secondary" onPress={() => supabase.auth.signOut()} />
      </Screen>
    );
  }

  return (
    <Screen>
      {request?.status === 'rejected' ? (
        <Card style={{ backgroundColor: '#FEF3F2', borderColor: '#FECDCA' }}>
          <Text style={{ color: colors.negative, fontWeight: '600' }}>בקשת ההצטרפות האחרונה נדחתה.</Text>
          <Text style={styles.muted}>אם זו טעות, בקשו ממנהל משק הבית קוד חדש ונסו שוב.</Text>
        </Card>
      ) : null}
      <Text style={styles.muted}>
        משק בית הוא המקום המשותף לשניכם. אחד יוצר אותו, והשני מבקש להצטרף עם קוד ההזמנה שמופיע בהגדרות. ההצטרפות
        נכנסת לתוקף רק אחרי שמנהל משק הבית מאשר אותה.
      </Text>
      <Chips
        options={[
          { id: 'create', label: 'יצירת משק בית' },
          { id: 'join', label: 'הצטרפות עם קוד' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <Card>
        <Field label="השם שלך" value={myName} onChangeText={setMyName} placeholder="למשל: איתי" />
        {mode === 'create' ? (
          <Field label="שם משק הבית" value={householdName} onChangeText={setHouseholdName} placeholder="למשל: הבית שלנו" />
        ) : (
          <Field label="קוד הזמנה" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="12 תווים" />
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={mode === 'create' ? 'יצירה' : 'שליחת בקשה להצטרפות'} onPress={submit} loading={busy} />
      </Card>
      <Button title="התנתקות" variant="secondary" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
