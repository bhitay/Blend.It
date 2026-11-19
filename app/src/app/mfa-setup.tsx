import { router } from 'expo-router';
import { createElement, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Button, Card, colors, ErrorText, Field, Screen, Text, styles } from '@/components/ui';
import { disableMfa, startEnrollment, verifyCode } from '@/lib/mfa';
import { useSession } from '@/lib/session';

/** Turn two-step verification on (QR + first code) or off. */
export default function MfaSetup() {
  const { mfaEnabled, refreshHousehold } = useSession();
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await startEnrollment());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!enrollment) return;
    if (code.replace(/\s/g, '').length !== 6) return setError('הקוד הוא 6 ספרות');
    setBusy(true);
    setError(null);
    try {
      await verifyCode(enrollment.factorId, code);
      await refreshHousehold();
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function turnOff() {
    const run = async () => {
      setBusy(true);
      try {
        await disableMfa();
        await refreshHousehold();
        router.back();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    };
    const msg = 'אחרי הכיבוי מספיקים אימייל וסיסמה כדי להיכנס לחשבון.';
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(msg)) run();
      return;
    }
    Alert.alert('לכבות אימות דו-שלבי?', msg, [
      { text: 'ביטול', style: 'cancel' },
      { text: 'כיבוי', style: 'destructive', onPress: run },
    ]);
  }

  if (mfaEnabled) {
    return (
      <Screen>
        <Card style={{ backgroundColor: '#ECFDF3', borderColor: '#ABEFC6' }}>
          <Text style={{ fontWeight: '700', color: colors.positive }}>אימות דו-שלבי פעיל</Text>
          <Text style={styles.muted}>בכל התחברות חדשה תתבקשו להזין קוד מאפליקציית האימות.</Text>
        </Card>
        <ErrorText>{error}</ErrorText>
        <Button title="כיבוי אימות דו-שלבי" variant="danger" onPress={turnOff} loading={busy} />
      </Screen>
    );
  }

  if (!enrollment) {
    return (
      <Screen>
        <Card>
          <Text style={{ fontWeight: '700', fontSize: 18 }}>מה זה?</Text>
          <Text style={styles.muted}>
            אחרי הסיסמה, האפליקציה תבקש גם קוד בן 6 ספרות שמתחלף כל 30 שניות באפליקציית אימות בטלפון. גם מי שיודע את
            הסיסמה לא ייכנס בלי הטלפון שלכם. הקוד נדרש רק בהתחברות חדשה, לא בכל פתיחה.
          </Text>
          <Text style={styles.muted}>
            צריך אפליקציית אימות: Google Authenticator, Microsoft Authenticator, או "סיסמאות" המובנית באייפון.
          </Text>
        </Card>
        <ErrorText>{error}</ErrorText>
        <Button title="הפעלה" onPress={begin} loading={busy} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ fontWeight: '700' }}>1. סרקו את הקוד באפליקציית האימות</Text>
        <View style={{ backgroundColor: '#fff', padding: 8, borderRadius: 8 }}>
          <QrCode uri={enrollment.qrUri} />
        </View>
        <Text style={[styles.muted, { fontSize: 13, textAlign: 'center' }]}>
          באותו טלפון? העתיקו את המפתח ידנית לאפליקציית האימות:
        </Text>
        <Text selectable style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, textAlign: 'center' }}>
          {enrollment.secret}
        </Text>
      </Card>
      <Card>
        <Text style={{ fontWeight: '700' }}>2. הזינו את הקוד שמופיע באפליקציה</Text>
        <Field
          label="קוד"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={7}
          onSubmitEditing={confirm}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="אישור והפעלה" onPress={confirm} loading={busy} />
      </Card>
    </Screen>
  );
}

/**
 * The QR code is an SVG. Browsers show it with a plain <img>; React Native's Image
 * can't draw SVG, so a native build falls back to the manual key shown below it.
 */
function QrCode({ uri }: { uri: string }) {
  if (Platform.OS !== 'web') return null;
  return createElement('img', { src: uri, width: 200, height: 200, alt: 'קוד QR להגדרת אימות דו-שלבי', style: { display: 'block' } });
}
