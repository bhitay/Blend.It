import { View } from 'react-native';
import type { Account, AccountDetails } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Insight } from '@/lib/insights';
import { Card, colors, Text, styles } from './ui';

const pct = (n: number | null | undefined) => (n == null ? null : `${n}%`);

/** One-line summary for lists: "תשואה 12 ח׳ 9.1% · דמי ניהול 0.55%". */
export function figuresLine(d: AccountDetails | null): string | null {
  if (!d) return null;
  const parts = [
    d.return_12m_pct != null ? `תשואה 12 ח׳ ${d.return_12m_pct}%` : d.return_ytd_pct != null ? `תשואה מתחילת השנה ${d.return_ytd_pct}%` : null,
    d.fee_balance_pct != null ? `דמי ניהול ${d.fee_balance_pct}%` : null,
    d.monthly_payment != null ? `החזר חודשי ${formatMoney(d.monthly_payment)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Every figure from the account's latest report. */
export function ReportFigures({ account }: { account: Account }) {
  const d = account.details;
  if (!d) return null;
  const rows: [string, string | null | undefined][] = [
    ['מסלול / מוצר', d.product_name],
    ['נכון ל', d.as_of ? formatDate(d.as_of) : null],
    ['הפקדה חודשית', d.monthly_deposit != null ? formatMoney(d.monthly_deposit) : null],
    ['תשואה מתחילת השנה', pct(d.return_ytd_pct)],
    ['תשואה 12 חודשים', pct(d.return_12m_pct)],
    ['דמי ניהול מצבירה', pct(d.fee_balance_pct)],
    ['דמי ניהול מהפקדה', pct(d.fee_deposit_pct)],
    ['ממוצע דמי ניהול בקופה', pct(d.fund_avg_fee_balance_pct)],
    ['מועד נזילות', d.liquidity_date ? formatDate(d.liquidity_date) : null],
    ['החזר חודשי', d.monthly_payment != null ? formatMoney(d.monthly_payment) : null],
    ['סיום', d.end_date ? formatDate(d.end_date) : null],
  ];
  const visible = rows.filter(([, v]) => v);
  return (
    <Card style={{ gap: 0, paddingVertical: 4 }}>
      {visible.map(([label, value], i) => (
        <View key={label} style={[styles.row, { paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <Text style={styles.muted}>{label}</Text>
          <Text style={{ fontWeight: '600' }}>{value}</Text>
        </View>
      ))}
      {(d.tracks ?? []).map((t, i) => (
        <View key={`${t.name}-${i}`} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 }}>
          <View style={styles.row}>
            <Text style={{ fontWeight: '600', flex: 1 }}>{t.name}</Text>
            <Text style={{ fontWeight: '600' }}>{t.balance != null ? formatMoney(t.balance) : '—'}</Text>
          </View>
          <Text style={[styles.muted, { fontSize: 13 }]}>
            {[t.interest_rate_pct != null ? `ריבית ${t.interest_rate_pct}%` : null, t.indexation, t.end_date ? `עד ${formatDate(t.end_date)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ))}
      {(d.highlights ?? []).length ? (
        <View style={{ paddingVertical: 10, borderTopWidth: visible.length ? 1 : 0, borderTopColor: colors.border, gap: 4 }}>
          {d.highlights!.map((h) => (
            <Text key={h} style={[styles.muted, { fontSize: 13 }]}>
              • {h}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function InsightCard({ insight }: { insight: Insight }) {
  const warn = insight.level === 'warn';
  const good = insight.level === 'good';
  return (
    <Card
      style={{
        borderColor: warn ? '#FEDF89' : good ? '#ABEFC6' : colors.border,
        backgroundColor: warn ? '#FFFAEB' : good ? '#ECFDF3' : colors.card,
        gap: 4,
      }}
    >
      <Text style={{ fontWeight: '700', color: warn ? colors.warning : good ? colors.positive : colors.text }}>{insight.title}</Text>
      <Text style={[styles.muted, { fontSize: 14 }]}>{insight.body}</Text>
    </Card>
  );
}
