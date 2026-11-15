import { Share, View } from 'react-native';
import { Button, Card, colors, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { useHousehold } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { household, members, userId } = useHousehold();

  return (
    <Screen>
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

      <SectionTitle>הזמנת בן/בת הזוג</SectionTitle>
      <Card>
        <Text style={styles.muted}>שלחו את הקוד. אחרי ההרשמה בוחרים "הצטרפות עם קוד" ומזינים אותו.</Text>
        <Text
          selectable
          style={{ fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center', color: colors.primary }}
        >
          {household.invite_code}
        </Text>
        <Button
          title="שליחת הקוד"
          variant="secondary"
          onPress={() =>
            Share.share({ message: `קוד ההצטרפות שלנו ל-BlendIt: ${household.invite_code}` }).catch(() => {})
          }
        />
      </Card>

      <Button title="התנתקות" variant="danger" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
