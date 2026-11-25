import { PrivateText } from '@/components/PrivateText';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Chips, colors, ErrorText, Loading, SectionTitle, Text, styles } from '@/components/ui';
import { fetchAccounts, type Account } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { fetchMonthlyTotals, fetchTransactionsSince, type CategorizedTransaction, type MonthlyCategoryTotal } from '@/lib/imports';
import { buildInsights, previousMonths, summarizeMonth, type Insight } from '@/lib/insights';
import { useHousehold } from '@/lib/session';

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function monthLabel(m: string) {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTH_NAMES[mm - 1]} ${String(y).slice(2)}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function Insights() {
  const { household } = useHousehold();
  const [totals, setTotals] = useState<MonthlyCategoryTotal[] | null>(null);
  const [txns, setTxns] = useState<CategorizedTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = previousMonths(currentMonth(), 8).at(-1)!;
      const [t, x, a] = await Promise.all([
        fetchMonthlyTotals(household.id, from),
        fetchTransactionsSince(household.id, from),
        fetchAccounts(household.id),
      ]);
      setTotals(t);
      setTxns(x);
      setAccounts(a);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [household.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const months = useMemo(
    () => [...new Set((totals ?? []).map((t) => t.month))].sort().reverse().slice(0, 6),
    [totals],
  );
  // Default: the latest full month with data (the current month is usually partial).
  const selected = month ?? months.find((m) => m !== currentMonth()) ?? months[0] ?? null;

  const summary = useMemo(() => (totals && selected ? summarizeMonth(totals, selected) : null), [totals, selected]);
  const insights: Insight[] = useMemo(
    () =>
      totals && selected
        ? buildInsights({
            month: selected,
            totals,
            transactions: txns,
            accounts: accounts.map((a) => ({ name: a.name, kind: a.kind, details: a.details })),
            today: new Date().toISOString().slice(0, 10),
          })
        : [],
    [totals, txns, accounts, selected],
  );

  if (!totals) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  if (!selected || !summary) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.screenContent}>
          <Card>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>עוד אין נתונים לניתוח</Text>
            <Text style={styles.muted}>העלו קובץ Excel של עו"ש או של כרטיס אשראי, והניתוח יופיע כאן.</Text>
            <Button title="להעלאת קובץ" onPress={() => router.push('/import')} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const maxCat = Math.max(1, ...summary.categories.map((c) => c.amount));

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.screenContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <Chips options={months.map((m) => ({ id: m, label: monthLabel(m) }))} value={selected} onChange={setMonth} />

        <Card>
          <View style={styles.row}>
            <Stat label="הכנסות" value={summary.income} color={colors.positive} />
            <Stat label="הוצאות" value={summary.expenses} />
            <Stat label="נשאר" value={summary.net} color={summary.net < 0 ? colors.negative : colors.text} />
          </View>
          {summary.savingsRate != null ? (
            <Text style={styles.muted}>שיעור חיסכון: {Math.round(summary.savingsRate * 100)}%</Text>
          ) : null}
          {summary.expenses > 0 ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.border }}>
                <View style={{ flex: summary.fixed, backgroundColor: colors.primary }} />
                <View style={{ flex: summary.variable, backgroundColor: '#7CC4BC' }} />
              </View>
              <View style={styles.row}>
                <PrivateText style={[styles.muted, { fontSize: 13 }]}>קבועות {formatMoney(summary.fixed)}</PrivateText>
                <PrivateText style={[styles.muted, { fontSize: 13 }]}>משתנות {formatMoney(summary.variable)}</PrivateText>
              </View>
            </View>
          ) : null}
        </Card>

        {insights.length > 0 ? (
          <>
            <SectionTitle>תובנות והמלצות</SectionTitle>
            {insights.map((i) => (
              <Card
                key={i.title}
                style={{
                  borderColor: i.level === 'warn' ? '#FEDF89' : i.level === 'good' ? '#ABEFC6' : colors.border,
                  backgroundColor: i.level === 'warn' ? '#FFFAEB' : i.level === 'good' ? '#ECFDF3' : colors.card,
                  gap: 4,
                }}
              >
                <PrivateText style={{ fontWeight: '700', color: i.level === 'warn' ? colors.warning : i.level === 'good' ? colors.positive : colors.text }}>{i.title}</PrivateText>
                <PrivateText style={[styles.muted, { fontSize: 14 }]}>{i.body}</PrivateText>
              </Card>
            ))}
          </>
        ) : null}

        <SectionTitle>לאן הלך הכסף</SectionTitle>
        <Card style={{ gap: 10 }}>
          {summary.categories.map((c) => (
            <View key={c.category} style={{ gap: 4 }}>
              <View style={styles.row}>
                <Text style={{ flex: 1 }}>
                  {c.category}
                  {c.isFixed ? <Text style={[styles.muted, { fontSize: 12 }]}> · קבועה</Text> : null}
                </Text>
                <PrivateText style={{ fontWeight: '600' }}>{formatMoney(c.amount)}</PrivateText>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ width: `${(c.amount / maxCat) * 100}%`, backgroundColor: c.isFixed ? colors.primary : '#7CC4BC' }} />
              </View>
            </View>
          ))}
          {summary.categories.length === 0 ? <Text style={styles.muted}>אין הוצאות בחודש הזה.</Text> : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={styles.muted}>{label}</Text>
      <PrivateText style={{ fontWeight: '800', fontSize: 18, color: color ?? colors.text }}>{formatMoney(value)}</PrivateText>
    </View>
  );
}
