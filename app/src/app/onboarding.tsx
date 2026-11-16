import { useState } from 'react';
import { Button, Card, Chips, ErrorText, Field, Screen, Text, styles } from '@/components/ui';
import { createHousehold, joinHousehold } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Onboarding() {
  const { refreshHousehold } = useSession();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [myName, setMyName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!myName.trim()) return setError('איך לקרוא לך?');
    if (mode === 'create' && !householdName.trim()) return setError('תנו שם למשק הבית');
    if (mode === 'join' && !code.trim()) return setError('הזינו את קוד ההזמנה');
    setBusy(true);
    try {
      if (mode === 'create') await createHousehold(householdName.trim(), myName.trim());
      else await joinHousehold(code.trim(), myName.trim());
      await refreshHousehold();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.muted}>
        משק בית הוא המקום המשותף לשניכם. אחד יוצר אותו, והשני מצטרף עם קוד ההזמנה שמופיע בהגדרות.
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
          <Field label="קוד הזמנה" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="8 תווים" />
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={mode === 'create' ? 'יצירה' : 'הצטרפות'} onPress={submit} loading={busy} />
      </Card>
      <Button title="התנתקות" variant="secondary" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
