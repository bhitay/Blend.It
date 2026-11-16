import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Button, Card, Chips, colors, ErrorText, Field, Screen, SectionTitle, Text, styles } from '@/components/ui';
import { createAccount, fetchAccounts, type Account } from '@/lib/api';
import { institutionLabel, INSTITUTIONS, KINDS, type AccountKind } from '@/lib/accountKinds';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import {
  applyMapping,
  readSpreadsheet,
  toBase64,
  upcomingCardCharges,
  validateMapping,
  type ParsedTransaction,
  type TableMapping,
} from '@/lib/importer';
import {
  analyzeDocument,
  analyzeTable,
  categorizePending,
  fetchImports,
  REPORT_ACCOUNT_KIND,
  REPORT_LABELS,
  saveReport,
  saveTransactions,
  type DocumentReport,
  type ImportRow,
} from '@/lib/imports';
import { useHousehold } from '@/lib/session';

const NEW = '__new__';
const JOINT = '__joint__';
const MAX_PDF_BYTES = 3_000_000; // request bodies to the server are capped at ~4.5MB after base64

type Step =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | {
      kind: 'table';
      fileName: string;
      mapping: TableMapping;
      transactions: ParsedTransaction[];
      balance: number | null;
      skipped: number;
    }
  | { kind: 'report'; fileName: string; report: DocumentReport }
  | { kind: 'done'; message: string };

export default function ImportScreen() {
  const { household, members, userId } = useHousehold();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  // Review choices
  const [accountChoice, setAccountChoice] = useState<string>(NEW);
  const [owner, setOwner] = useState<string>(JOINT);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async () => {
    const [a, i] = await Promise.all([fetchAccounts(household.id), fetchImports(household.id)]);
    setAccounts(a);
    setImports(i);
  }, [household.id]);

  useFocusEffect(
    useCallback(() => {
      reload().catch((e) => setError((e as Error).message));
    }, [reload]),
  );

  // --- picking & analyzing ----------------------------------------------------

  async function pick() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'text/html',
        '*/*',
      ],
      copyToCacheDirectory: false,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const fileName = asset.name ?? 'file';
    try {
      setStep({ kind: 'working', message: 'קורא את הקובץ…' });
      const data: ArrayBuffer = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();
      const isPdf = /\.pdf$/i.test(fileName) || asset.mimeType === 'application/pdf';
      if (isPdf) await handlePdf(fileName, data);
      else await handleSheet(fileName, data);
    } catch (e) {
      setStep({ kind: 'idle' });
      setError((e as Error).message);
    }
  }

  async function handlePdf(fileName: string, data: ArrayBuffer) {
    if (data.byteLength > MAX_PDF_BYTES) throw new Error('הקובץ גדול מדי (מעל 3MB). נסו להוריד דוח של תקופה קצרה יותר.');
    setStep({ kind: 'working', message: 'מנתח את הדוח… (עד דקה)' });
    const report = await analyzeDocument(fileName, toBase64(data));
    prepareReview(REPORT_ACCOUNT_KIND[report.report_type] ?? null, report.institution, report.account_hint, report.owner_name);
    setNewName([REPORT_LABELS[report.report_type], report.institution].filter(Boolean).join(' – '));
    setStep({ kind: 'report', fileName, report });
  }

  async function handleSheet(fileName: string, data: ArrayBuffer) {
    const sheets = readSpreadsheet(data);
    if (sheets.length === 0) throw new Error('לא נמצאו נתונים בקובץ');
    setStep({ kind: 'working', message: 'מזהה את מבנה הקובץ…' });

    // Each sheet is mapped separately (e.g. Max: domestic and foreign transactions).
    const analyzed = await Promise.all(
      sheets.slice(0, 4).map(async (s) => {
        try {
          const mapping = await analyzeTable(fileName, s.rows);
          if (mapping.source_type !== 'bank' && mapping.source_type !== 'credit_card') return { mapping, result: null };
          if (validateMapping(mapping, s.rows)) return { mapping, result: null };
          return { mapping, result: applyMapping(s.rows, mapping) };
        } catch (e) {
          return { mapping: null, result: null, error: (e as Error).message };
        }
      }),
    );
    const usable = analyzed.filter((a) => a.result && a.result.transactions.length > 0);
    if (usable.length === 0) {
      const err = analyzed.find((a) => 'error' in a && a.error);
      if (err && 'error' in err) throw new Error(err.error);
      const type = analyzed[0]?.mapping?.source_type;
      if (type === 'insurance_list') throw new Error('זה קובץ ביטוחים מהר הביטוח. ניתוח ביטוחים יגיע בשלב הבא.');
      throw new Error('לא הצלחתי לזהות תנועות בקובץ. אם זה ייצוא מהבנק או מחברת האשראי, שלחו לי דוגמה ואוסיף תמיכה.');
    }

    const mapping = usable[0].mapping!;
    const transactions = usable.flatMap((u) => u.result!.transactions);
    const skipped = usable.reduce((s, u) => s + u.result!.skipped, 0);
    const balance =
      mapping.source_type === 'credit_card'
        ? mapping.closing_balance != null
          ? Math.abs(mapping.closing_balance)
          : upcomingCardCharges(transactions, todayISO())
        : (mapping.closing_balance ?? usable[0].result!.lastRunningBalance);

    const kind: AccountKind = mapping.source_type === 'credit_card' ? 'credit_card' : 'bank';
    prepareReview(kind, mapping.institution, mapping.account_hint, mapping.owner_name);
    setNewName([institutionLabel(mapping.institution) ?? KINDS[kind].label, mapping.account_hint].filter(Boolean).join(' '));
    setStep({ kind: 'table', fileName, mapping, transactions, balance, skipped });
  }

  /** Preselects the most likely existing account, or "new". */
  function prepareReview(kind: AccountKind | null, institution: string | null, hint: string | null, ownerName: string | null) {
    const candidates = kind ? accounts.filter((a) => a.kind === kind) : [];
    const inst = normalizeInstitution(institution);
    const best =
      candidates.find((a) => inst && a.institution === inst && hint && (a.name.includes(hint) || a.external_id === hint)) ??
      candidates.find((a) => inst && a.institution === inst) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    setAccountChoice(best?.id ?? NEW);
    const m = ownerName ? members.find((x) => ownerName.includes(x.display_name)) : undefined;
    setOwner(m?.user_id ?? (kind === 'credit_card' || kind === 'pension' || kind === 'study_fund' ? userId : JOINT));
  }

  // --- saving -------------------------------------------------------------------

  async function ensureAccount(kind: AccountKind, institution: string | null, hint: string | null): Promise<string> {
    if (accountChoice !== NEW) return accountChoice;
    return createAccount({
      householdId: household.id,
      kind,
      name: newName.trim() || KINDS[kind].label,
      institution: normalizeInstitution(institution),
      ownerUserId: owner === JOINT ? null : owner,
      balance: null,
      externalId: hint,
    });
  }

  async function confirmTable() {
    if (step.kind !== 'table') return;
    setError(null);
    const { mapping, transactions, balance, fileName } = step;
    try {
      setStep({ kind: 'working', message: 'שומר…' });
      const kind: AccountKind = mapping.source_type === 'credit_card' ? 'credit_card' : 'bank';
      const accountId = await ensureAccount(kind, mapping.institution, mapping.account_hint);
      const lastDate = transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
      const res = await saveTransactions({
        accountId,
        fileName,
        reportType: mapping.source_type,
        transactions,
        balance,
        balanceAsOf: kind === 'credit_card' ? todayISO() : lastDate || null,
      });
      setStep({ kind: 'working', message: 'מסווג תנועות…' });
      let classified = 0;
      let note = '';
      try {
        classified = await categorizePending(household.id);
      } catch (e) {
        note = ` הסיווג האוטומטי נכשל (${(e as Error).message}). אפשר לנסות שוב מאוחר יותר.`;
      }
      await reload();
      const dup = res.rows - res.new_rows;
      setStep({
        kind: 'done',
        message:
          `נוספו ${res.new_rows} תנועות חדשות` +
          (dup ? ` (${dup} כבר היו ודולגו)` : '') +
          (classified ? `, ${classified} סווגו.` : '.') +
          note,
      });
    } catch (e) {
      setError((e as Error).message);
      setStep(step);
    }
  }

  async function confirmReport() {
    if (step.kind !== 'report') return;
    setError(null);
    const { report, fileName } = step;
    try {
      setStep({ kind: 'working', message: 'שומר…' });
      const kind = REPORT_ACCOUNT_KIND[report.report_type];
      const accountId = kind ? await ensureAccount(kind, report.institution, report.account_hint) : null;
      await saveReport({ householdId: household.id, accountId, fileName, report });
      await reload();
      setStep({ kind: 'done', message: kind ? 'הדוח נשמר והחשבון עודכן.' : 'הדוח נשמר.' });
    } catch (e) {
      setError((e as Error).message);
      setStep(step);
    }
  }

  // --- render ---------------------------------------------------------------------

  if (step.kind === 'working') {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ textAlign: 'center' }}>{step.message}</Text>
        </View>
      </Screen>
    );
  }

  if (step.kind === 'table' || step.kind === 'report') {
    const kind: AccountKind | null =
      step.kind === 'table'
        ? step.mapping.source_type === 'credit_card'
          ? 'credit_card'
          : 'bank'
        : (REPORT_ACCOUNT_KIND[step.report.report_type] ?? null);
    const candidates = kind ? accounts.filter((a) => a.kind === kind) : [];
    return (
      <Screen>
        {step.kind === 'table' ? <TableSummary step={step} /> : <ReportSummary report={step.report} />}
        {kind ? (
          <>
            <SectionTitle>לאיזה חשבון לשייך?</SectionTitle>
            <Chips
              options={[...candidates.map((a) => ({ id: a.id, label: a.name })), { id: NEW, label: '+ חשבון חדש' }]}
              value={accountChoice}
              onChange={setAccountChoice}
            />
            {accountChoice === NEW ? (
              <Card>
                <Field label="שם החשבון" value={newName} onChangeText={setNewName} />
                <Text style={styles.label}>של מי</Text>
                <Chips
                  options={[{ id: JOINT, label: 'משותף' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name }))]}
                  value={owner}
                  onChange={setOwner}
                />
              </Card>
            ) : null}
          </>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <Button title="אישור ושמירה" onPress={step.kind === 'table' ? confirmTable : confirmReport} />
        <Button title="ביטול" variant="secondary" onPress={() => setStep({ kind: 'idle' })} />
      </Screen>
    );
  }

  return (
    <Screen>
      {step.kind === 'done' ? (
        <Card style={{ backgroundColor: '#ECFDF3', borderColor: '#ABEFC6' }}>
          <Text style={{ color: colors.positive, fontWeight: '600' }}>{step.message}</Text>
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={pick}
        style={({ pressed }) => [
          {
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: colors.primary,
            borderRadius: 16,
            padding: 24,
            alignItems: 'center',
            gap: 8,
            backgroundColor: pressed ? colors.primarySoft : colors.card,
          },
        ]}
      >
        <Ionicons name="cloud-upload-outline" size={36} color={colors.primary} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.primary, textAlign: 'center' }}>העלאת קובץ</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          Excel מהבנק או מכרטיס האשראי, או PDF של דוח פנסיה, השתלמות או משכנתא
        </Text>
      </Pressable>
      <ErrorText>{error}</ErrorText>

      <Checklist accounts={accounts} imports={imports} />

      {imports.length > 0 ? (
        <>
          <SectionTitle>העלאות אחרונות</SectionTitle>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {imports.slice(0, 10).map((i, idx) => (
              <View
                key={i.id}
                style={[styles.row, { paddingVertical: 10 }, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1}>{accounts.find((a) => a.id === i.account_id)?.name ?? i.file_name}</Text>
                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {i.kind === 'transactions'
                      ? `${i.new_rows} תנועות חדשות · ${formatDate(i.period_start)}–${formatDate(i.period_end)}`
                      : (REPORT_LABELS[i.report_type as DocumentReport['report_type']] ?? 'דוח')}
                  </Text>
                </View>
                <Text style={[styles.muted, { fontSize: 12 }]}>{formatDate(i.created_at)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function normalizeInstitution(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const match = INSTITUTIONS.find((i) => i.id.toLowerCase() === s.toLowerCase() || s.includes(i.label));
  return match?.id ?? s;
}

function TableSummary({ step }: { step: Extract<Step, { kind: 'table' }> }) {
  const { mapping, transactions, balance, skipped } = step;
  const dates = transactions.map((t) => t.date).sort();
  const income = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spent = -transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const card = mapping.source_type === 'credit_card';
  return (
    <>
      <Card>
        <Text style={styles.muted}>{card ? 'פירוט כרטיס אשראי' : 'תנועות עו"ש'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '800' }}>
          {[institutionLabel(mapping.institution), mapping.account_hint].filter(Boolean).join(' ') || step.fileName}
        </Text>
        <Text>
          {transactions.length} תנועות · {formatDate(dates[0])}–{formatDate(dates[dates.length - 1])}
        </Text>
        <View style={styles.row}>
          <Text style={styles.muted}>{card ? 'זיכויים' : 'נכנס'}</Text>
          <Text style={{ color: colors.positive, fontWeight: '600' }}>{formatMoney(income)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>{card ? 'חיובים' : 'יצא'}</Text>
          <Text style={{ fontWeight: '600' }}>{formatMoney(spent)}</Text>
        </View>
        {balance != null ? (
          <View style={styles.row}>
            <Text style={styles.muted}>{card ? 'חיוב קרוב' : 'יתרה'}</Text>
            <Text style={{ fontWeight: '600' }}>{formatMoney(card ? -balance : balance)}</Text>
          </View>
        ) : null}
        {skipped ? <Text style={[styles.muted, { fontSize: 12 }]}>{skipped} שורות סיכום/כותרת דולגו.</Text> : null}
        {mapping.notes ? <Text style={[styles.muted, { fontSize: 13 }]}>{mapping.notes}</Text> : null}
      </Card>
      <SectionTitle>דוגמה מהתנועות</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {transactions.slice(0, 5).map((t, i) => (
          <View key={t.external_id} style={[styles.row, { paddingVertical: 8 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1}>{t.description}</Text>
              <Text style={[styles.muted, { fontSize: 12 }]}>{formatDate(t.date)}</Text>
            </View>
            <Text style={{ fontWeight: '600', color: t.amount > 0 ? colors.positive : colors.text }}>
              {formatMoney(t.amount, 'ILS', true)}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function ReportSummary({ report }: { report: DocumentReport }) {
  const line = (label: string, value: string | null) =>
    value ? (
      <View style={styles.row} key={label}>
        <Text style={styles.muted}>{label}</Text>
        <Text style={{ fontWeight: '600' }}>{value}</Text>
      </View>
    ) : null;
  const pct = (n: number | null) => (n == null ? null : `${n}%`);
  const money = (n: number | null) => (n == null ? null : formatMoney(n));
  return (
    <Card>
      <Text style={styles.muted}>{REPORT_LABELS[report.report_type]}</Text>
      <Text style={{ fontSize: 22, fontWeight: '800' }}>
        {[report.institution, report.product_name].filter(Boolean).join(' · ') || 'דוח'}
      </Text>
      {line('נכון ל', report.as_of ? formatDate(report.as_of) : null)}
      {line(report.report_type === 'mortgage' || report.report_type === 'loan' ? 'יתרה לסילוק' : 'צבירה', money(report.balance))}
      {line('הפקדה חודשית', money(report.monthly_deposit))}
      {line('תשואה מתחילת השנה', pct(report.return_ytd_pct))}
      {line('תשואה 12 חודשים', pct(report.return_12m_pct))}
      {line('דמי ניהול מצבירה', pct(report.fee_balance_pct))}
      {line('דמי ניהול מהפקדה', pct(report.fee_deposit_pct))}
      {line('מועד נזילות', report.liquidity_date ? formatDate(report.liquidity_date) : null)}
      {line('החזר חודשי', money(report.monthly_payment))}
      {report.tracks.map((t) =>
        line(t.name, [money(t.balance), t.interest_rate_pct != null ? `${t.interest_rate_pct}%` : null, t.indexation].filter(Boolean).join(' · ')),
      )}
      {report.highlights.map((h) => (
        <Text key={h} style={[styles.muted, { fontSize: 13 }]}>
          • {h}
        </Text>
      ))}
    </Card>
  );
}

/** What to upload this month / quarter, and what's already in. */
function Checklist({ accounts, imports }: { accounts: Account[]; imports: ImportRow[] }) {
  const items = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastImport = (id: string) => imports.find((i) => i.account_id === id)?.created_at ?? null;
    const daysAgo = (iso: string | null) => (iso ? (now.getTime() - new Date(iso).getTime()) / 86_400_000 : Infinity);

    const rule = (k: AccountKind): { label: string; ok: (last: string | null) => boolean } | null => {
      if (k === 'bank' || k === 'credit_card') return { label: 'חודשי', ok: (l) => !!l && new Date(l).getTime() >= monthStart };
      if (k === 'pension' || k === 'study_fund' || k === 'provident' || k === 'insurance' || k === 'investment')
        return { label: 'רבעוני', ok: (l) => daysAgo(l) <= 100 };
      if (k === 'mortgage' || k === 'loan') return { label: 'שנתי', ok: (l) => daysAgo(l) <= 365 };
      return null;
    };
    return accounts
      .map((a) => ({ a, r: rule(a.kind), last: lastImport(a.id) }))
      .filter((x) => x.r)
      .map((x) => ({ id: x.a.id, name: x.a.name, freq: x.r!.label, done: x.r!.ok(x.last), last: x.last }))
      .sort((a, b) => Number(a.done) - Number(b.done));
  }, [accounts, imports]);

  if (items.length === 0) return null;
  const pending = items.filter((i) => !i.done).length;
  return (
    <>
      <SectionTitle>{pending ? `מה להעלות (${pending} חסרים)` : 'הכל עדכני ✓'}</SectionTitle>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {items.map((i, idx) => (
          <View key={i.id} style={[styles.row, { paddingVertical: 10 }, idx > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Ionicons
              name={i.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={i.done ? colors.positive : colors.muted}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text>{i.name}</Text>
              <Text style={[styles.muted, { fontSize: 12 }]}>
                {i.freq}
                {i.last ? ` · הועלה לאחרונה ${formatDate(i.last)}` : ' · עוד לא הועלה'}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}
