import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import InviteCard from '@/components/InviteCard';
import JoinRequests from '@/components/JoinRequests';
import { Button, Card, colors, ErrorText, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { removeMember } from '@/lib/api';
import { useHousehold, useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { household, members, userId, refreshHousehold } = useHousehold();
  const isOwner = members.find((m) => m.user_id === userId)?.role === 'owner';
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(memberId: string, name: string) {
    const msg = `${name} יאבד/תאבד מיד את הגישה לכל הנתונים של משק הבית. החשבונות וההיסטוריה שלו/ה נשארים אצלכם. אפשר להזמין שוב בהמשך.`;
    const ok =
      Platform.OS === 'web'
        ? Boolean(globalThis.confirm?.(`להסיר את ${name}?\n\n${msg}`))
        : await new Promise<boolean>((resolve) =>
            Alert.alert(`להסיר את ${name}?`, msg, [
              { text: 'ביטול', style: 'cancel', onPress: () => resolve(false) },
              { text: 'הסרה', style: 'destructive', onPress: () => resolve(true) },
            ]),
          );
    if (!ok) return;
    setRemoving(true);
    setError(null);
    try {
      await removeMember(household.id, memberId);
      await refreshHousehold();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemoving(false);
    }
  }
  const { mfaEnabled } = useSession();

  return (
    <Screen>
      <JoinRequests />
      <SectionTitle>משק הבית</SectionTitle>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{household.name}</Text>
        {members.map((m) => (
          <View key={m.user_id} style={styles.row}>
            <Text style={{ flex: 1 }}>{m.display_name}</Text>
            <Text style={styles.muted}>{m.user_id === userId ? 'את/ה' : m.role === 'owner' ? 'מנהל/ת' : 'חבר/ה'}</Text>
            {isOwner && m.user_id !== userId && m.role !== 'owner' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`הסרת ${m.display_name}`}
                onPress={() => remove(m.user_id, m.display_name)}
                hitSlop={8}
                disabled={removing}
              >
                <Text style={{ color: colors.negative, fontWeight: '600' }}>הסרה</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <ErrorText>{error}</ErrorText>
      </Card>

      <SectionTitle>הוספת חבר</SectionTitle>
      <InviteCard />

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
