import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import InviteCard from '@/components/InviteCard';
import JoinRequests from '@/components/JoinRequests';
import { Button, Card, colors, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { useHousehold, useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { household, members, userId } = useHousehold();
  const { mfaEnabled } = useSession();

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
