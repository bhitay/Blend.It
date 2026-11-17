import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, colors, ErrorText, Loading, SectionTitle, Text, styles } from '@/components/ui';
import { GROUPS, KINDS } from '@/lib/accountKinds';
import { daysSince, formatMoney } from '@/lib/format';
import { useAccounts } from '@/lib/useAccounts';

const STALE_DAYS = 45;

export default function Overview() {
  const { accounts, error, refreshing, refresh } = useAccounts();
  if (!accounts) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const byGroup = GROUPS.map((g) => {
    const items = accounts.filter((a) => KINDS[a.kind].group === g.id);
    return { ...g, count: items.length, total: items.reduce((s, a) => s + a.signed_balance, 0) };
  }).filter((g) => g.count > 0);

  const assets = accounts.filter((a) => !a.is_liability).reduce((s, a) => s + a.signed_balance, 0);
  const debts = accounts.filter((a) => a.is_liability).reduce((s, a) => s + a.signed_balance, 0);
  const netWorth = assets + debts;
  const stale = accounts.filter((a) => (daysSince(a.balance_as_of) ?? Infinity) > STALE_DAYS);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Card style={{ alignItems: 'stretch' }}>
          <Text style={styles.muted}>שווי נקי משפחתי</Text>
          <Text
            style={{ fontSize: 36, fontWeight: '800', color: netWorth < 0 ? colors.negative : colors.text }}
            accessibilityLabel={`שווי נקי ${formatMoney(netWorth)}`}
          >
            {formatMoney(netWorth)}
          </Text>
          <View style={styles.row}>
            <Stat label="נכסים" value={assets} />
            <Stat label="התחייבויות" value={debts} />
          </View>
        </Card>

        {accounts.length === 0 ? (
          <Card>
            <Text style={{ fontWeight: '700', fontSize: 18 }}>בואו נתחיל</Text>
            <Text style={styles.muted}>
              הוסיפו את החשבונות שלכם: עו"ש, פנסיה, קרן השתלמות, גמל, דירה ומשכנתא.
            </Text>
            <Button title="הוספת חשבון ראשון" onPress={() => router.push('/account/new')} />
          </Card>
        ) : (
          <>
            <SectionTitle>לפי סוג</SectionTitle>
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {byGroup.map((g, i) => (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}
                  style={({ pressed }) => [
                    styles.row,
                    { paddingVertical: 12, opacity: pressed ? 0.6 : 1 },
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600' }}>{g.label}</Text>
                    <Text style={styles.muted}>{g.count === 1 ? 'חשבון אחד' : `${g.count} חשבונות`}</Text>
                  </View>
                  <Text style={{ fontWeight: '700', color: g.total < 0 ? colors.negative : colors.text }}>
                    {formatMoney(g.total)}
                  </Text>
                  <Ionicons name="chevron-back" size={18} color={colors.muted} />
                </Pressable>
              ))}
            </Card>
          </>
        )}

        {stale.length > 0 ? (
          <Card style={{ backgroundColor: '#FFFAEB', borderColor: '#FEDF89' }}>
            <Text style={{ fontWeight: '600', color: colors.warning }}>
              {stale.length === 1 ? 'חשבון אחד לא עודכן' : `${stale.length} חשבונות לא עודכנו`} מעל {STALE_DAYS} יום
            </Text>
            <Text style={styles.muted}>{stale.map((a) => a.name).join(', ')}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={{ fontWeight: '700', color: value < 0 ? colors.negative : colors.text }}>{formatMoney(value)}</Text>
    </View>
  );
}
