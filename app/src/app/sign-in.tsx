import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Button, Card, colors, ErrorText, Field, Screen, Text, styles } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
            autoComplete="email"
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
        <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')} accessibilityRole="button">
          <Text style={{ textAlign: 'center', color: colors.primary, fontWeight: '600' }}>
            {mode === 'in' ? 'אין לך משתמש? הרשמה' : 'כבר רשומים? התחברות'}
          </Text>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
