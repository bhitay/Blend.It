import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Button, Card, colors, ErrorText, Loading, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { createDeviceCredential, hasDeviceCredential, isAvailable, verifyUser } from '@/lib/deviceAuth';
import { formatDate } from '@/lib/format';
import { deletePasskey, listPasskeys, registerPasskey, type Passkey } from '@/lib/passkeys';
import { usePrivacy } from '@/lib/privacy';
import { useSession } from '@/lib/session';

/** Face ID settings: sign-in passkeys (server-verified) and the on-device eye / app lock. */
export default function FaceIdSettings() {
  const { session } = useSession();
  const { settings, updateSettings } = usePrivacy();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadPasskeys() {
    try {
      setPasskeys(await listPasskeys());
      setPasskeyError(null);
    } catch (e) {
      setPasskeys([]);
      setPasskeyError((e as Error).message);
    }
  }

  useEffect(() => {
    isAvailable().then(setAvailable);
    loadPasskeys();
  }, []);

  if (available === null) return <Loading />;

  if (!available) {
    return (
      <Screen>
        <Card>
          <Text style={{ fontWeight: '700', fontSize: 18 }}>Face ID לא זמין כאן</Text>
          <Text style={styles.muted}>
            פתחו את BlendIt באייפון מהאייקון שבמסך הבית (בספארי), במכשיר עם Face ID או Touch ID.
          </Text>
        </Card>
      </Screen>
    );
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      await loadPasskeys();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deletePasskey(id);
      await loadPasskeys();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Turning an on-device option on or off always needs Face ID (so nobody else can switch it off). */
  async function setOption(key: 'appLock', value: boolean) {
    setError(null);
    try {
      const hasCredential = hasDeviceCredential() || (passkeys?.length ?? 0) > 0;
      if (value && !hasCredential) {
        await createDeviceCredential(session?.user.email ?? 'BlendIt');
      } else if (!(await verifyUser())) {
        setError('הזיהוי לא הצליח, ההגדרה לא שונתה.');
        return;
      }
      updateSettings({ ...settings, [key]: value });
    } catch (e) {
      setError((e as Error).message.includes('NotAllowed') ? 'הפעולה בוטלה.' : (e as Error).message);
    }
  }

  return (
    <Screen>
      <SectionTitle>כניסה עם Face ID</SectionTitle>
      <Card>
        <Text style={styles.muted}>
          מתחברים עם Face ID במקום אימייל וסיסמה. הזיהוי נבדק בשרת של Supabase. נשמר ב"סיסמאות" של האייפון ומגובה
          ב-iCloud.
        </Text>
        {passkeys === null ? null : passkeys.length === 0 ? (
          <Text style={styles.muted}>עוד לא הוגדר.</Text>
        ) : (
          passkeys.map((p) => (
            <View key={p.id} style={[styles.row, { paddingVertical: 6 }]}>
              <Ionicons name="finger-print" size={20} color={colors.positive} />
              <View style={{ flex: 1 }}>
                <Text>{p.name ?? 'Passkey'}</Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {p.createdAt ? `נוסף ${formatDate(p.createdAt)}` : ''}
                  {p.lastUsedAt ? ` · שימוש אחרון ${formatDate(p.lastUsedAt)}` : ''}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="הסרה" onPress={() => removePasskey(p.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={colors.negative} />
              </Pressable>
            </View>
          ))
        )}
        {passkeyError ? <Text style={{ color: colors.warning, fontSize: 13 }}>{passkeyError}</Text> : null}
        <Button title={passkeys?.length ? 'הוספת מכשיר נוסף' : 'הפעלת כניסה עם Face ID'} onPress={addPasskey} loading={busy} />
      </Card>

      <SectionTitle>בתוך האפליקציה (במכשיר הזה)</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <View style={[styles.row, { paddingVertical: 12 }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontWeight: '600' }}>נעילת האפליקציה</Text>
            <Text style={[styles.muted, { fontSize: 13 }]}>Face ID בכל פתיחה ובכל חזרה לאפליקציה, לפני שמשהו מוצג.</Text>
          </View>
          <Switch value={settings.appLock} onValueChange={(v) => setOption('appLock', v)} trackColor={{ true: colors.primary }} />
        </View>
      </Card>
      <Text style={[styles.muted, { fontSize: 12 }]}>
        הנעילה נבדקת במכשיר עצמו ומגינה על המסך, למשל כשמישהו מחזיק את הטלפון הפתוח. הנתונים עצמם מוגנים בהתחברות
        ובאימות הדו-שלבי.
      </Text>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
