import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Button, Card, colors, ErrorText, Field, Loading, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { deleteAccount, fetchAccount, fetchHistory, setArchived, setBalance, type Account, type Snapshot } from '@/lib/api';
import { institutionLabel, KINDS } from '@/lib/accountKinds';
import { formatDate, formatMoney, parseAmount } from '@/lib/format';

export default function AccountDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([fetchAccount(id), fetchHistory(id)]);
      setAccount(a);
      setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!account) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const sign = account.is_liability ? -1 : 1;

  async function saveBalance() {
    const amount = parseAmount(input);
    if (amount == null) return setError('היתרה לא תקינה');
    setError(null);
    setBusy(true);
    try {
      await setBalance(account!.id, amount);
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
    const msg = 'החשבון וכל היסטוריית היתרות שלו יימחקו.';
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
      <Stack.Screen options={{ title: account.name }} />
      <Card>
        <Text style={styles.muted}>
          {[KINDS[account.kind].label, institutionLabel(account.institution)].filter(Boolean).join(' · ')}
        </Text>
        <Text style={{ fontSize: 32, fontWeight: '800', color: account.signed_balance < 0 ? colors.negative : colors.text }}>
          {account.balance == null ? '—' : formatMoney(account.signed_balance, account.currency)}
        </Text>
        <Text style={styles.muted}>
          {account.balance_as_of ? `עודכן ${formatDate(account.balance_as_of)}` : 'עוד לא הוזנה יתרה'}
          {account.source === 'manual' ? ' · הזנה ידנית' : ''}
        </Text>
      </Card>

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

      {history.length > 0 ? (
        <>
          <SectionTitle>היסטוריה</SectionTitle>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {history.map((s, i) => (
              <View
                key={s.as_of}
                style={[styles.row, { paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <Text style={styles.muted}>{formatDate(s.as_of)}</Text>
                <Text style={{ fontWeight: '600' }}>{formatMoney(sign * s.balance, account.currency)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

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
