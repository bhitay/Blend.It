import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, Chips, colors, ErrorText, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, TRANSFER_CATEGORIES } from '@/lib/categories';
import { formatMoney } from '@/lib/format';
import { setMerchantCategory } from '@/lib/imports';
import { useHousehold } from '@/lib/session';

/** Re-categorize a merchant. The choice becomes a rule for every past and future transaction with this description. */
export default function CategoryScreen() {
  const { household } = useHousehold();
  const params = useLocalSearchParams<{ description: string; category?: string; amount?: string }>();
  const amount = Number(params.amount ?? 0);
  const [category, setCategory] = useState<string | null>(params.category || null);
  const [isFixed, setIsFixed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTransfer = (TRANSFER_CATEGORIES as readonly string[]).includes(category ?? '');
  const groups = [
    { title: 'הוצאות', items: EXPENSE_CATEGORIES },
    { title: 'הכנסות', items: INCOME_CATEGORIES },
    { title: 'לא הכנסה ולא הוצאה', items: TRANSFER_CATEGORIES },
  ];

  async function save() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await setMerchantCategory({
        householdId: household.id,
        merchant: params.description,
        category,
        isFixed: isTransfer ? false : isFixed,
        isTransfer,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{params.description}</Text>
        {amount ? <Text style={styles.muted}>{formatMoney(amount, 'ILS', true)}</Text> : null}
        <Text style={[styles.muted, { fontSize: 13 }]}>הסיווג יחול על כל התנועות מבית העסק הזה, גם בעתיד.</Text>
      </Card>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: 8 }}>
          <SectionTitle>{g.title}</SectionTitle>
          <Chips options={g.items.map((c) => ({ id: c, label: c }))} value={category} onChange={setCategory} />
        </View>
      ))}
      {!isTransfer ? (
        <Card style={[styles.row, { paddingVertical: 12 }] as never}>
          <Text style={{ flex: 1 }}>הוצאה קבועה (חוזרת כל חודש)</Text>
          <Switch value={isFixed} onValueChange={setIsFixed} trackColor={{ true: colors.primary }} />
        </Card>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button title="שמירה" onPress={save} loading={busy} disabled={!category} />
    </Screen>
  );
}
