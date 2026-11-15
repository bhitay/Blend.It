import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Chips, ErrorText, Field, Screen, SectionTitle } from '@/components/ui';
import { createAccount } from '@/lib/api';
import { INSTITUTIONS, KIND_ORDER, KINDS, type AccountKind } from '@/lib/accountKinds';
import { parseAmount } from '@/lib/format';
import { useHousehold } from '@/lib/session';

const OTHER = '__other__';
const JOINT = '__joint__';

export default function NewAccount() {
  const { household, members } = useHousehold();
  const [kind, setKind] = useState<AccountKind>('bank');
  const [institution, setInstitution] = useState<string | null>(null);
  const [otherInstitution, setOtherInstitution] = useState('');
  const [owner, setOwner] = useState<string>(JOINT);
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const institutions = INSTITUTIONS.filter((i) => i.kinds.includes(kind));
  const liability = KINDS[kind].liability;

  async function save() {
    setError(null);
    const inst = institution === OTHER ? otherInstitution.trim() || null : institution;
    const finalName = name.trim() || [KINDS[kind].label, INSTITUTIONS.find((i) => i.id === inst)?.label ?? inst].filter(Boolean).join(' ');
    const amount = balance.trim() ? parseAmount(balance) : null;
    if (balance.trim() && amount == null) return setError('היתרה לא תקינה');
    setBusy(true);
    try {
      await createAccount({
        householdId: household.id,
        kind,
        name: finalName,
        institution: inst,
        ownerUserId: owner === JOINT ? null : owner,
        balance: amount,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SectionTitle>סוג</SectionTitle>
      <Chips
        options={KIND_ORDER.map((k) => ({ id: k, label: KINDS[k].label }))}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setInstitution(null);
        }}
      />

      <SectionTitle>גוף מנהל</SectionTitle>
      <Chips
        options={[...institutions.map((i) => ({ id: i.id, label: i.label })), { id: OTHER, label: 'אחר' }]}
        value={institution}
        onChange={setInstitution}
      />
      {institution === OTHER ? (
        <Field
          label="שם הגוף"
          value={otherInstitution}
          onChangeText={setOtherInstitution}
          placeholder="למשל: מגדל, הראל, אלטשולר שחם"
        />
      ) : null}

      <SectionTitle>של מי</SectionTitle>
      <Chips
        options={[{ id: JOINT, label: 'משותף' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name }))]}
        value={owner}
        onChange={setOwner}
      />

      <Card>
        <Field label="שם (לא חובה)" value={name} onChangeText={setName} placeholder={KINDS[kind].label} />
        <Field
          label={liability ? 'יתרת חוב נוכחית' : 'יתרה נוכחית'}
          value={balance}
          onChangeText={setBalance}
          keyboardType="numbers-and-punctuation"
          placeholder="₪"
          hint={liability ? 'הזינו את הסכום שנותר לשלם, בלי מינוס' : undefined}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="שמירה" onPress={save} loading={busy} />
      </Card>
    </Screen>
  );
}
