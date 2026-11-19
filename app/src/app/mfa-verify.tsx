import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, colors, ErrorText, Field, Screen, Text, styles } from '@/components/ui';
import { verifySignIn } from '@/lib/mfa';
import { supabase } from '@/lib/supabase';

/** Second step at sign-in. Shown until the session passes it; the database withholds data until then. */
export default function MfaVerify() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (code.replace(/\s/g, '').length !== 6) return setError('הקוד הוא 6 ספרות');
    setBusy(true);
    setError(null);
    try {
      await verifySignIn(code);
      // MFA_CHALLENGE_VERIFIED reloads the session and the household.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ marginTop: 48, marginBottom: 8, gap: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primary, alignSelf: 'flex-start' }}>BlendIt</Text>
        <Text style={styles.muted}>אימות דו-שלבי</Text>
      </View>
      <Card>
        <Text>הזינו את הקוד בן 6 הספרות מאפליקציית האימות.</Text>
        <Field
          label="קוד"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={7}
          onSubmitEditing={submit}
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <Button title="אימות" onPress={submit} loading={busy} />
      </Card>
      <Button title="התנתקות" variant="secondary" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
