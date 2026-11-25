import { PrivateText } from '@/components/PrivateText';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { figuresLine } from '@/components/ReportFigures';
import { Button, Card, colors, ErrorText, Loading, Text, styles } from '@/components/ui';
import { GROUPS, institutionLabel, KINDS, type AccountGroup } from '@/lib/accountKinds';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import { accountInsights } from '@/lib/insights';
import { useOwnerLabel } from '@/lib/session';
import { useAccounts } from '@/lib/useAccounts';

/** All accounts in one overview group (e.g. pension, study fund and provident), with their key figures. */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: AccountGroup }>();
  const group = GROUPS.find((g) => g.id === id);
  const { accounts, error, refreshing, refresh } = useAccounts();
  const ownerLabel = useOwnerLabel();

  if (!accounts) return error ? <ErrorText>{error}</ErrorText> : <Loading />;
  const items = accounts.filter((a) => KINDS[a.kind].group === id);
  const total = items.reduce((s, a) => s + a.signed_balance, 0);
  const today = todayISO();

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: group?.label ?? '' }} />
      <ScrollView contentContainerStyle={styles.screenContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Card>
          <Text style={styles.muted}>סה"כ</Text>
          <PrivateText style={{ fontSize: 30, fontWeight: '800', color: total < 0 ? colors.negative : colors.text }}>{formatMoney(total)}</PrivateText>
          <Text style={styles.muted}>{items.length === 1 ? 'חשבון אחד' : `${items.length} חשבונות`}</Text>
        </Card>

        {items.map((a) => {
          const insights = accountInsights({ name: a.name, kind: a.kind, details: a.details }, today);
          const warnings = insights.filter((i) => i.level === 'warn').length;
          const line = figuresLine(a.details);
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/account/[id]', params: { id: a.id } })}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card style={{ gap: 6 }}>
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: '700', fontSize: 17 }}>{a.name}</Text>
                    <Text style={styles.muted}>
                      {[KINDS[a.kind].label, institutionLabel(a.institution), ownerLabel(a.owner_user_id)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <PrivateText style={{ fontWeight: '800', fontSize: 17, color: a.signed_balance < 0 ? colors.negative : colors.text }}>
                    {a.balance == null ? '—' : formatMoney(a.signed_balance)}
                  </PrivateText>
                  <Ionicons name="chevron-back" size={18} color={colors.muted} />
                </View>
                {line ? <PrivateText style={{ fontSize: 14 }}>{line}</PrivateText> : null}
                <View style={styles.row}>
                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {a.balance_as_of ? `עודכן ${formatDate(a.balance_as_of)}` : 'אין יתרה'}
                  </Text>
                  {warnings ? (
                    <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>
                      {warnings === 1 ? 'המלצה אחת' : `${warnings} המלצות`}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          );
        })}

        <Button title="+ הוספת חשבון" variant="secondary" onPress={() => router.push('/account/new')} />
      </ScrollView>
    </SafeAreaView>
  );
}
