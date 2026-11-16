// Shared by the app and the /api/analyze server function.

export const EXPENSE_CATEGORIES = [
  'מזון וסופר',
  'מסעדות ובתי קפה',
  'דלק ותחבורה',
  'רכב',
  'דיור ושכירות',
  'משכנתא והלוואות',
  'חשבונות בית',
  'תקשורת ואינטרנט',
  'ביטוחים',
  'בריאות ופארם',
  'חינוך וגנים',
  'ילדים',
  'ביגוד והנעלה',
  'בית וריהוט',
  'פנאי ובילויים',
  'חופשות ונסיעות',
  'מנויים ודיגיטל',
  'קניות אונליין',
  'מתנות ותרומות',
  'טיפוח',
  'חיות מחמד',
  'עמלות בנק',
  'מיסים ואגרות',
  'מזומן',
  'אחר',
] as const;

export const INCOME_CATEGORIES = ['משכורת', 'הכנסה משכירות', 'קצבאות והחזרים', 'הכנסה אחרת'] as const;

export const TRANSFER_CATEGORIES = ['תשלום כרטיס אשראי', 'העברה בין חשבונות', 'חיסכון והשקעות'] as const;

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...TRANSFER_CATEGORIES] as const;

export type Category = (typeof ALL_CATEGORIES)[number];

export function isIncomeCategory(c: string | null | undefined): boolean {
  return (INCOME_CATEGORIES as readonly string[]).includes(c ?? '');
}
