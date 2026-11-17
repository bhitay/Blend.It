import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Card, Chips, ErrorText, Field, Loading, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { fetchAccount, updateAccount, type Account, type AccountDetails } from '@/lib/api';
import { INSTITUTIONS, KIND_ORDER, KINDS, type AccountKind } from '@/lib/accountKinds';
import { parseAmount } from '@/lib/format';
import { useHousehold } from '@/lib/session';

const JOINT = '__joint__';
const SAVINGS_KINDS: AccountKind[] = ['pension', 'study_fund', 'provident', 'insurance', 'investment'];
const DEBT_KINDS: AccountKind[] = ['mortgage', 'loan'];

type NumField = 'monthly_deposit' | 'return_ytd_pct' | 'return_12m_pct' | 'fee_balance_pct' | 'fee_deposit_pct' | 'monthly_payment';

/** Edit an account: name, type, company, owner — and fix figures read from a report. */
export default function EditAccount() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { members } = useHousehold();
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [institution, setInstitution] = useState('');
  const [owner, setOwner] = useState(JOINT);
  const [nums, setNums] = useState<Record<NumField, string>>({
    monthly_deposit: '', return_ytd_pct: '', return_12m_pct: '', fee_balance_pct: '', fee_deposit_pct: '', monthly_payment: '',
  });
  const [liquidity, setLiquidity] = useState('');
  const [product, setProduct] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccount(id).then((a) => {
      if (!a) return;
      setAccount(a);
      setName(a.name);
      setKind(a.kind);
      setInstitution(INSTITUTIONS.find((i) => i.id === a.institution)?.label ?? a.institution ?? '');
      setOwner(a.owner_user_id ?? JOINT);
      const d = a.details ?? {};
      const str = (n: number | null | undefined) => (n == null ? '' : String(n));
      setNums({
        monthly_deposit: str(d.monthly_deposit),
        return_ytd_pct: str(d.return_ytd_pct),
        return_12m_pct: str(d.return_12m_pct),
        fee_balance_pct: str(d.fee_balance_pct),
        fee_deposit_pct: str(d.fee_deposit_pct),
        monthly_payment: str(d.monthly_payment),
      });
      setLiquidity(d.liquidity_date ? d.liquidity_date.split('-').reverse().join('/') : '');
      setProduct(d.product_name ?? '');
    }, (e) => setError((e as Error).message));
  }, [id]);

  if (!account) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const isSavings = SAVINGS_KINDS.includes(kind);
  const isDebt = DEBT_KINDS.includes(kind);

  async function save() {
    setError(null);
    if (!name.trim()) return setError('צריך שם לחשבון');
    const details: AccountDetails = { ...(account!.details ?? {}) };
    for (const k of Object.keys(nums) as NumField[]) {
      const raw = nums[k].trim();
      if (!raw) {
        details[k] = null;
        continue;
      }
      const n = parseAmount(raw);
      if (n == null) return setError('אחד המספרים לא תקין');
      details[k] = n;
    }
    if (liquidity.trim()) {
      const m = liquidity.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
      if (!m) return setError('מועד נזילות בפורמט DD/MM/YYYY');
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      details.liquidity_date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    } else {
      details.liquidity_date = null;
    }
    details.product_name = product.trim() || null;
    const inst = institution.trim();
    setBusy(true);
    try {
      await updateAccount(account!.id, {
        name: name.trim(),
        kind,
        institution: INSTITUTIONS.find((i) => i.label === inst)?.id ?? (inst || null),
        owner_user_id: owner === JOINT ? null : owner,
        details: Object.values(details).some((v) => v != null && !(Array.isArray(v) && v.length === 0)) ? details : null,
      });
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const numField = (k: NumField, label: string, hint?: string) => (
    <Field
      key={k}
      label={label}
      hint={hint}
      value={nums[k]}
      onChangeText={(v) => setNums((s) => ({ ...s, [k]: v }))}
      keyboardType="numbers-and-punctuation"
    />
  );

  return (
    <Screen>
      <Card>
        <Field label="שם" value={name} onChangeText={setName} />
        <Field label="חברה / בנק" value={institution} onChangeText={setInstitution} placeholder="למשל: הראל, מזרחי טפחות" />
      </Card>

      <SectionTitle>של מי</SectionTitle>
      <Chips
        options={[{ id: JOINT, label: 'משותף' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name }))]}
        value={owner}
        onChange={setOwner}
      />

      <SectionTitle>סוג</SectionTitle>
      <Chips options={KIND_ORDER.map((k) => ({ id: k, label: KINDS[k].label }))} value={kind} onChange={setKind} />

      {isSavings || isDebt ? (
        <>
          <SectionTitle>נתונים מהדוח</SectionTitle>
          <Text style={[styles.muted, { fontSize: 13 }]}>
            נמלאים אוטומטית מהדוח האחרון שהועלה. אפשר לתקן כאן אם משהו נקרא לא נכון. אחוזים כמספר: 0.55 = 0.55%.
          </Text>
          <Card>
            <Field label="מסלול / מוצר" value={product} onChangeText={setProduct} />
            {isSavings ? (
              <>
                {numField('monthly_deposit', 'הפקדה חודשית (₪)')}
                {numField('return_ytd_pct', 'תשואה מתחילת השנה (%)')}
                {numField('return_12m_pct', 'תשואה 12 חודשים (%)')}
                {numField('fee_balance_pct', 'דמי ניהול מצבירה (%)')}
                {numField('fee_deposit_pct', 'דמי ניהול מהפקדה (%)')}
                {kind === 'study_fund' ? (
                  <Field label="מועד נזילות" value={liquidity} onChangeText={setLiquidity} placeholder="DD/MM/YYYY" />
                ) : null}
              </>
            ) : (
              numField('monthly_payment', 'החזר חודשי (₪)')
            )}
          </Card>
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="שמירה" onPress={save} loading={busy} />
    </Screen>
  );
}
