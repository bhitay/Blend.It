// Finding amounts inside text, for privacy mode. No React Native imports (unit-tested).

/** Amounts as formatMoney / the insights write them: "‏15,100 ‏₪", "‏‎-905,000 ‏₪", "₪15,100", "$19.99". */
const MONEY = /[‎‏]*-?[‎‏]*\d[\d,]*(?:\.\d+)?\s?[‎‏]*[₪$€£]|[₪$€£]\s?-?\d[\d,]*(?:\.\d+)?/g;

export type TextPart = { text: string; money: boolean };

/** Splits text into plain parts and amounts. */
export function splitMoney(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MONEY)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index), money: false });
    parts.push({ text: m[0], money: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), money: false });
  return parts;
}

/**
 * What a hidden amount renders as: the same shape with made-up digits, so the real
 * number is not in the page at all (not even under the blur, or when text is copied).
 */
export function placeholderFor(amount: string): string {
  let i = 0;
  return amount.replace(/\d/g, () => '8632514790'[i++ % 10]);
}
