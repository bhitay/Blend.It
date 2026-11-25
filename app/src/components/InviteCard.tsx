import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { createInvite, revokeInvite } from '@/lib/api';
import { useHousehold } from '@/lib/session';
import { Button, Card, colors, ErrorText, Text, styles } from './ui';

export function formatInviteCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

function remaining(expiresAt: string | null, now: number): number {
  return expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 0;
}

/**
 * Owner: "add member" issues a one-time code valid for 15 minutes. The first person
 * to use it sends a join request (the code is then spent), which the owner approves.
 */
export default function InviteCard() {
  const { household, members, userId, refreshHousehold } = useHousehold();
  const isOwner = members.find((m) => m.user_id === userId)?.role === 'owner';
  const full = members.length >= household.max_members;
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = household.invite_open && remaining(household.invite_expires_at, now) > 0;
  const seconds = remaining(household.invite_expires_at, now);

  // Countdown, and a refresh every few seconds so a spent code disappears.
  useEffect(() => {
    if (!household.invite_open) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => refreshHousehold(), 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [household.invite_open, refreshHousehold]);

  if (full) return <Text style={[styles.muted, { fontSize: 13 }]}>משק הבית מלא. אי אפשר להוסיף חברים.</Text>;
  if (!isOwner) return <Text style={[styles.muted, { fontSize: 13 }]}>רק מנהל משק הבית יכול להוסיף חברים.</Text>;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshHousehold();
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <Card>
        <Text style={{ fontWeight: '700' }}>הוספת חבר למשק הבית</Text>
        <Text style={styles.muted}>
          נוצר קוד חד-פעמי שתקף ל-15 דקות. שולחים אותו לבן/בת הזוג, הם מזינים אותו באפליקציה, ואתם מאשרים את הבקשה.
        </Text>
        <ErrorText>{error}</ErrorText>
        <Button title="יצירת קוד הזמנה" onPress={() => run(() => createInvite(household.id))} loading={busy} />
      </Card>
    );
  }

  const code = formatInviteCode(household.invite_code);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <Card>
      <Text style={{ fontWeight: '700' }}>קוד הזמנה חד-פעמי</Text>
      <Text selectable style={{ fontSize: 26, fontWeight: '800', letterSpacing: 2, textAlign: 'center', color: colors.primary, writingDirection: 'ltr' }}>
        {code}
      </Text>
      <View style={[styles.row, { justifyContent: 'center' }]}>
        <Ionicons name="time-outline" size={16} color={colors.muted} />
        <Text style={styles.muted}>
          בתוקף עוד {mm}:{ss} · עובד פעם אחת בלבד
        </Text>
      </View>
      <Button
        title="שליחת הקוד"
        onPress={() =>
          Share.share({
            message: `קוד הצטרפות ל-BlendIt (תקף ל-15 דקות, לשימוש אחד): ${code}`,
          }).catch(() => {})
        }
      />
      <Button title="ביטול הקוד" variant="danger" onPress={() => run(() => revokeInvite(household.id))} loading={busy} />
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
