import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import JoinRequests from '@/components/JoinRequests';
import { Button, Card, colors, ErrorText, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { regenerateInvite } from '@/lib/api';
import { useHousehold, useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { household, members, userId, refreshHousehold } = useHousehold();
  const { mfaEnabled } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = members.find((m) => m.user_id === userId)?.role === 'owner';
  const full = members.length >= household.max_members;

  async function newCode() {
    setBusy(true);
    setError(null);
    try {
      await regenerateInvite(household.id);
      await refreshHousehold();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <JoinRequests />
      <SectionTitle>משק הבית</SectionTitle>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{household.name}</Text>
        {members.map((m) => (
          <View key={m.user_id} style={styles.row}>
            <Text>{m.display_name}</Text>
            <Text style={styles.muted}>{m.user_id === userId ? 'את/ה' : m.role === 'owner' ? 'מנהל/ת' : 'חבר/ה'}</Text>
          </View>
        ))}
      </Card>

      {household.invite_open && !full ? (
        <>
          <SectionTitle>הזמנת בן/בת הזוג</SectionTitle>
          <Card>
            <Text style={styles.muted}>
              שלחו את הקוד. אחרי ההרשמה בוחרים "הצטרפות עם קוד" ומזינים אותו. הבקשה תופיע כאן לאישור שלכם, ורק
              אחרי האישור תהיה גישה לנתונים.
            </Text>
            <Text selectable style={{ fontSize: 24, fontWeight: '800', letterSpacing: 3, textAlign: 'center', color: colors.primary }}>
              {household.invite_code}
            </Text>
            <Button
              title="שליחת הקוד"
              variant="secondary"
              onPress={() => Share.share({ message: `קוד ההצטרפות שלנו ל-BlendIt: ${household.invite_code}` }).catch(() => {})}
            />
          </Card>
        </>
      ) : (
        <Text style={[styles.muted, { fontSize: 13 }]}>
          {full ? 'משק הבית מלא. קוד ההזמנה סגור ואי אפשר להצטרף.' : 'קוד ההזמנה סגור.'}
        </Text>
      )}
      {isOwner && !full && !household.invite_open ? (
        <Button title="יצירת קוד הזמנה חדש" variant="secondary" onPress={newCode} loading={busy} />
      ) : null}
      <ErrorText>{error}</ErrorText>

      <SectionTitle>אבטחה</SectionTitle>
      <Pressable accessibilityRole="button" onPress={() => router.push('/mfa-setup')}>
        <Card style={[styles.row, { paddingVertical: 14 }] as never}>
          <Ionicons name={mfaEnabled ? 'shield-checkmark' : 'shield-outline'} size={22} color={mfaEnabled ? colors.positive : colors.warning} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontWeight: '600' }}>אימות דו-שלבי</Text>
            <Text style={[styles.muted, { fontSize: 13 }]}>{mfaEnabled ? 'פעיל' : 'כבוי. מומלץ להפעיל'}</Text>
          </View>
          <Ionicons name="chevron-back" size={18} color={colors.muted} />
        </Card>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => router.push('/face-id')}>
        <Card style={[styles.row, { paddingVertical: 14 }] as never}>
          <Ionicons name="scan-outline" size={22} color={colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontWeight: '600' }}>Face ID</Text>
            <Text style={[styles.muted, { fontSize: 13 }]}>כניסה ונעילת האפליקציה</Text>
          </View>
          <Ionicons name="chevron-back" size={18} color={colors.muted} />
        </Card>
      </Pressable>

      <Button title="התנתקות" variant="danger" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
