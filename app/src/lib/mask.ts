// Shared by the app (before anything leaves the device) and the server function.

/**
 * Masks identifiers before rows leave the device: any run of 7+ digits (ID numbers,
 * full account / card numbers, phone numbers), optionally split by spaces or dashes,
 * becomes "•••1234". Amounts are left alone (they have a decimal point or thousands
 * commas), and so are dates. Only the masked copy is sent; parsing uses the originals.
 */
export function maskIdentifiers(cell: string): string {
  return cell.replace(/(?<![\d.,])\d(?:[ -]?\d){6,}(?![\d]|[.,]\d)/g, (m) => {
    // Dates written with dashes (2026-11-05, 05-11-2026) are not identifiers.
    if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}-\d{1,2}-\d{2,4}$/.test(m)) return m;
    const digits = m.replace(/\D/g, '');
    return `•••${digits.slice(-4)}`;
  });
}
