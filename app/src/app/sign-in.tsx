import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Button, Card, colors, ErrorText, Field, Screen, Text, styles } from '@/components/ui';
import { isAvailable } from '@/lib/deviceAuth';
import { offerPasskeyAutofill, signInWithPasskey } from '@/lib/passkeys';
import { usePrivacy } from '@/lib/privacy';
import { supabase } from '@/lib/supabase';

export default function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [faceId, setFaceId] = useState(false);
  const { signedInJustNow } = usePrivacy();

  // Passkey suggestion above the keyboard on the email field (no extra iOS sheet).
  const autofill = useRef<AbortController | null>(null);
  useEffect(() => {
    isAvailable().then(setFaceId);
    const ctrl = new AbortController();
    autofill.current = ctrl;
    offerPasskeyAutofill(ctrl.signal).then((ok) => {
      if (ok) signedInJustNow();
    });
    return () => ctrl.abort();
  }, [signedInJustNow]);

  async function passkey() {
    setError(null);
    autofill.current?.abort(); // only one Face ID request at a time
    setBusy(true);
    try {
      await signInWithPasskey();
      signedInJustNow();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(null);
    setInfo(null);
    if (!email.trim() || password.length < 8) {
      setError('צריך אימייל וסיסמה של 8 תווים לפחות');
      return;
    }
    setBusy(true);
    const creds = { email: email.trim(), password };
    const { data, error } =
      mode === 'in' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setBusy(false);
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : error.message);
    } else if (mode === 'up' && !data.session) {
      setInfo('נשלח אליך מייל אימות. אחרי האישור חזרו לכאן והתחברו.');
      setMode('in');
    } else if (data.session) {
      signedInJustNow();
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen edges={['top', 'bottom']}>
        <View style={{ marginTop: 48, marginBottom: 8, gap: 6 }}>
          <Text style={{ fontSize: 34, fontWeight: '800', color: colors.primary, alignSelf: 'flex-start' }}>BlendIt</Text>
          <Text style={styles.muted}>כל הכסף של המשפחה, במקום אחד.</Text>
        </View>
        <Card>
          <Field
            label="אימייל"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete={(faceId ? 'username webauthn' : 'email') as 'email'}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Field
            label="סיסמה"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            textContentType={mode === 'in' ? 'password' : 'newPassword'}
            onSubmitEditing={submit}
          />
          <ErrorText>{error}</ErrorText>
          {info ? <Text style={{ color: colors.positive }}>{info}</Text> : null}
          <Button title={mode === 'in' ? 'התחברות' : 'יצירת משתמש'} onPress={submit} loading={busy} />
        </Card>
        {faceId && mode === 'in' ? <Button title="כניסה עם Face ID" variant="secondary" onPress={passkey} /> : null}
        <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')} accessibilityRole="button">
          <Text style={{ textAlign: 'center', color: colors.primary, fontWeight: '600' }}>
            {mode === 'in' ? 'אין לך משתמש? הרשמה' : 'כבר רשומים? התחברות'}
          </Text>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
