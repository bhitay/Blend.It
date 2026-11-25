import { PrivateText } from '@/components/PrivateText';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { InsightCard, ReportFigures } from '@/components/ReportFigures';
import { PrivacyToggle } from '@/components/PrivateText';
import { Button, Card, colors, ErrorText, Field, Loading, Screen, SectionTitle, Text, styles } from '@/components/ui';
import {
  deleteAccount,
  fetchAccount,
  fetchHistory,
  fetchTransactions,
  setArchived,
  setBalance,
  type Account,
  type Snapshot,
  type Transaction,
} from '@/lib/api';
import { institutionLabel, KINDS } from '@/lib/accountKinds';
import { formatDate, formatMoney, parseAmount, todayISO } from '@/lib/format';
import { accountInsights } from '@/lib/insights';
import { useOwnerLabel } from '@/lib/session';

export default function AccountDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerLabel = useOwnerLabel();

  const load = useCallback(async () => {
    try {
      const [a, h, t] = await Promise.all([fetchAccount(id), fetchHistory(id), fetchTransactions(id)]);
      setAccount(a);
      setHistory(h);
      setTxns(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  // Reload when coming back from the edit screen or a category change.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!account) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const imported = account.source === 'import';
  const sign = account.is_liability ? -1 : 1;
  const insights = accountInsights({ name: account.name, kind: account.kind, details: account.details }, todayISO());
  const editButton = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    <PrivacyToggle />
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/account/edit', params: { id: account.id } })}
      hitSlop={10}
    >
      <Text style={{ color: colors.primary, fontWeight: '600' }}>עריכה</Text>
    </Pressable>
    </View>
  );

  async function saveBalance() {
    const amount = parseAmount(input);
    if (amount == null) return setError('היתרה לא תקינה');
    setError(null);
    setBusy(true);
    try {
      await setBalance(account!.id, amount, account!.is_liability);
      setInput('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    const run = async () => {
      await deleteAccount(account!.id);
      router.back();
    };
    const msg = imported ? 'החשבון, כל התנועות וההיסטוריה שלו יימחקו.' : 'החשבון וכל היסטוריית היתרות שלו יימחקו.';
    if (Platform.OS === 'web') {
      if (globalThis.confirm?.(msg)) run();
      return;
    }
    Alert.alert('למחוק את החשבון?', msg, [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחיקה', style: 'destructive', onPress: run },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: account.name, headerRight: () => editButton }} />
      <Card>
        <Text style={styles.muted}>
          {[KINDS[account.kind].label, institutionLabel(account.institution), ownerLabel(account.owner_user_id)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <PrivateText style={{ fontSize: 32, fontWeight: '800', color: account.signed_balance < 0 ? colors.negative : colors.text }}>
          {account.balance == null ? '—' : formatMoney(account.signed_balance, account.currency)}
        </PrivateText>
        <Text style={styles.muted}>
          {account.balance_as_of ? `עודכן ${formatDate(account.balance_as_of)}` : 'עוד לא הוזנה יתרה'}
          {imported ? ' · מתעדכן מקבצים' : ' · הזנה ידנית'}
        </Text>
        {imported && account.kind === 'credit_card' ? (
          <Text style={styles.muted}>הסכום הוא החיובים שעוד לא ירדו מהבנק.</Text>
        ) : null}
      </Card>

      {account.details ? (
        <>
          <SectionTitle>נתונים מהדוח האחרון</SectionTitle>
          <ReportFigures account={account} />
        </>
      ) : null}

      {insights.length > 0 ? (
        <>
          <SectionTitle>המלצות</SectionTitle>
          {insights.map((i) => (
            <InsightCard key={i.title} insight={i} />
          ))}
        </>
      ) : null}

      {account.kind !== 'credit_card' ? (
        <Card>
          <Field
            label={account.is_liability ? 'עדכון יתרת חוב' : 'עדכון יתרה'}
            value={input}
            onChangeText={setInput}
            keyboardType="numbers-and-punctuation"
            placeholder="₪"
            onSubmitEditing={saveBalance}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="עדכון" onPress={saveBalance} loading={busy} disabled={!input.trim()} />
        </Card>
      ) : null}

      {txns.length > 0 ? (
        <>
          <SectionTitle>תנועות אחרונות</SectionTitle>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {txns.map((t, i) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityHint="שינוי סיווג"
                onPress={() =>
                  router.push({
                    pathname: '/category',
                    params: { description: t.description, category: t.category ?? '', amount: String(t.amount) },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  { paddingVertical: 10, opacity: pressed ? 0.6 : 1 },
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1}>{t.description}</Text>
                  <PrivateText style={[styles.muted, { fontSize: 12 }]}>
                    {[
                      formatDate(t.date),
                      t.category ?? 'לא מסווג',
                      t.status === 'pending' ? 'ממתין' : null,
                      t.installments ? `תשלום ${t.installments.number}/${t.installments.total}` : null,
                      t.original_currency && t.original_currency !== 'ILS' && t.original_amount != null
                        ? formatMoney(t.original_amount, t.original_currency, true)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </PrivateText>
                </View>
                <PrivateText style={{ fontWeight: '600', color: t.amount > 0 ? colors.positive : colors.text }}>
                  {formatMoney(t.amount, 'ILS', true)}
                </PrivateText>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {history.length > 0 ? (
        <>
          <SectionTitle>היסטוריית יתרות</SectionTitle>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {history.map((s, i) => (
              <View
                key={s.as_of}
                style={[styles.row, { paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <Text style={styles.muted}>{formatDate(s.as_of)}</Text>
                <PrivateText style={{ fontWeight: '600' }}>{formatMoney(sign * s.balance, account.currency)}</PrivateText>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Button title="עריכת פרטי החשבון" variant="secondary" onPress={() => router.push({ pathname: '/account/edit', params: { id: account.id } })} />
      <Button
        title="העברה לארכיון"
        variant="secondary"
        onPress={async () => {
          await setArchived(account.id, true);
          router.back();
        }}
      />
      <Button title="מחיקת החשבון" variant="danger" onPress={confirmDelete} />
    </Screen>
  );
}
