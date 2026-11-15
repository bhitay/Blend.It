export type AccountKind =
  | 'bank'
  | 'credit_card'
  | 'savings'
  | 'pension'
  | 'study_fund'
  | 'provident'
  | 'insurance'
  | 'investment'
  | 'real_estate'
  | 'mortgage'
  | 'loan'
  | 'other';

export type AccountGroup = 'cash' | 'longterm' | 'investments' | 'property' | 'debts';

type KindInfo = { label: string; group: AccountGroup; liability: boolean };

export const KINDS: Record<AccountKind, KindInfo> = {
  bank: { label: 'עו"ש', group: 'cash', liability: false },
  savings: { label: 'פיקדון / חיסכון', group: 'cash', liability: false },
  credit_card: { label: 'כרטיס אשראי', group: 'debts', liability: true },
  pension: { label: 'קרן פנסיה', group: 'longterm', liability: false },
  study_fund: { label: 'קרן השתלמות', group: 'longterm', liability: false },
  provident: { label: 'קופת גמל', group: 'longterm', liability: false },
  insurance: { label: 'ביטוח / חיסכון בביטוח', group: 'longterm', liability: false },
  investment: { label: 'תיק השקעות', group: 'investments', liability: false },
  real_estate: { label: 'נדל"ן', group: 'property', liability: false },
  mortgage: { label: 'משכנתא', group: 'debts', liability: true },
  loan: { label: 'הלוואה', group: 'debts', liability: true },
  other: { label: 'אחר', group: 'cash', liability: false },
};

/** Display order of kinds in pickers. */
export const KIND_ORDER: AccountKind[] = [
  'bank',
  'credit_card',
  'savings',
  'pension',
  'study_fund',
  'provident',
  'insurance',
  'investment',
  'real_estate',
  'mortgage',
  'loan',
  'other',
];

export const GROUPS: { id: AccountGroup; label: string }[] = [
  { id: 'cash', label: 'עו"ש וחסכונות' },
  { id: 'longterm', label: 'פנסיה, השתלמות וגמל' },
  { id: 'investments', label: 'השקעות' },
  { id: 'property', label: 'נדל"ן' },
  { id: 'debts', label: 'התחייבויות' },
];

/** Institutions with automatic sync planned (ids match israeli-bank-scrapers). */
export const INSTITUTIONS: { id: string; label: string; kinds: AccountKind[] }[] = [
  { id: 'mizrahi', label: 'מזרחי טפחות', kinds: ['bank', 'savings', 'mortgage', 'loan', 'investment'] },
  { id: 'discount', label: 'דיסקונט', kinds: ['bank', 'savings', 'loan', 'investment'] },
  { id: 'otsarHahayal', label: 'אוצר החייל', kinds: ['bank', 'savings', 'loan', 'investment'] },
  { id: 'max', label: 'מקס', kinds: ['credit_card'] },
  { id: 'isracard', label: 'ישראכרט', kinds: ['credit_card'] },
  { id: 'amex', label: 'אמריקן אקספרס', kinds: ['credit_card'] },
  { id: 'visaCal', label: 'כאל', kinds: ['credit_card'] },
];

export function institutionLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return INSTITUTIONS.find((i) => i.id === id)?.label ?? id;
}
