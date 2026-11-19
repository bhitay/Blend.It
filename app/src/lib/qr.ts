/**
 * Supabase returns the QR as "data:image/svg+xml;utf-8,<svg …>" with the markup not
 * URL-encoded, so a "#" in a colour ends the URI early and the image never loads.
 * Re-encode the SVG as base64.
 */
export function qrToDataUri(qr: string): string {
  let svg = qr;
  const comma = qr.indexOf(',');
  if (qr.startsWith('data:') && comma > 0) {
    const meta = qr.slice(0, comma);
    const body = qr.slice(comma + 1);
    if (meta.endsWith(';base64')) return qr;
    try {
      svg = decodeURIComponent(body);
    } catch {
      svg = body;
    }
  }
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
