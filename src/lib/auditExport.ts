// =============================================================================
// Audit-log → printable PDF
//
// Renders the audit chain for one booking to a tamper-evident PDF. The
// printable copy includes the SHA-256 hash returned by booking_audit_hash —
// if anyone (admin included) modifies the underlying audit_logs row later,
// the hash on the customer's document will no longer match a freshly-
// computed hash from the DB. Forms the basis of "you cannot deny this
// happened" in a legal context.
//
// Pairs with src/lib/printReceipt.ts — both lazy-import expo-print so this
// module loads even when the PDF stack isn't installed.
// =============================================================================

import type { BookingAuditRow } from '@/lib/data/useBookingAudit';
import { fmtDateLong, fmtTime } from '@/lib/format';

export interface AuditExportData {
  bookingShortCode: string;
  bookingId: string;
  customerName: string;
  customerEmail?: string;
  pickup: string;
  dropoff: string;
  scheduledForDate: string;
  rows: BookingAuditRow[];
  /** SHA-256 returned by booking_audit_hash. */
  chainHash: string | null;
  generatedAt: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch),
  );
}

function fmtAction(action: string): string {
  // booking.created → "Booking created"
  return action
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildAuditHtml(data: AuditExportData): string {
  const rows = data.rows
    .map((r) => {
      const payload = r.payload && Object.keys(r.payload).length > 0
        ? `<pre class="payload">${escapeHtml(JSON.stringify(r.payload, null, 2))}</pre>`
        : '<span class="muted">—</span>';
      return `<tr>
        <td class="ts">
          <div>${escapeHtml(fmtDateLong(r.created_at))}</div>
          <div class="muted">${escapeHtml(fmtTime(r.created_at))}</div>
        </td>
        <td>
          <div class="action">${escapeHtml(fmtAction(r.action))}</div>
          <div class="muted">${escapeHtml(r.actor_role ?? 'system')} · ${escapeHtml(r.entity_type)}#${escapeHtml(r.id.toString())}</div>
        </td>
        <td>${payload}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Movvy audit log ${escapeHtml(data.bookingShortCode)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0A0A0A; padding: 32px; max-width: 820px; margin: 0 auto; }
  .brand { font-size: 28px; font-weight: 800; color: #047857; letter-spacing: -0.5px; }
  .muted { color: #71717A; font-size: 12px; }
  .card { border: 1px solid #E4E4E7; border-radius: 14px; padding: 20px; margin-top: 20px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717A; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: #71717A; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; padding: 0 0 8px; border-bottom: 1px solid #E4E4E7; }
  td { vertical-align: top; padding: 10px 6px; border-bottom: 1px solid #F4F4F5; }
  td.ts { white-space: nowrap; width: 130px; }
  td .action { font-weight: 700; }
  pre.payload { background: #FAFAFA; border: 1px solid #F4F4F5; padding: 8px; border-radius: 6px; font-size: 11px; white-space: pre-wrap; word-break: break-all; max-width: 320px; }
  .hash { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; word-break: break-all; background: #FAFAFA; padding: 10px; border-radius: 6px; border: 1px solid #F4F4F5; }
</style>
</head>
<body>
  <div class="brand">Movvy</div>
  <div class="muted">Tamper-evident audit log · Booking #${escapeHtml(data.bookingShortCode)}</div>

  <div class="card">
    <h2>Move</h2>
    <p style="margin:0;font-size:14px">
      ${escapeHtml(data.customerName)}${data.customerEmail ? ' · ' + escapeHtml(data.customerEmail) : ''}
    </p>
    <p class="muted" style="margin-top:4px">
      Scheduled ${escapeHtml(data.scheduledForDate)} · Pickup ${escapeHtml(data.pickup)} · Drop-off ${escapeHtml(data.dropoff)}
    </p>
  </div>

  <div class="card">
    <h2>Audit chain (${data.rows.length} events)</h2>
    <table>
      <thead>
        <tr>
          <th>When</th><th>Event</th><th>Payload</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No events recorded yet.</td></tr>`}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Tamper-evident hash</h2>
    <p class="muted" style="margin:0 0 10px">
      SHA-256 of every audit row in this booking's chain, concatenated in
      timestamp order. Movvy support can re-compute this server-side at any
      time. If even one row has been altered or removed, the hash will no
      longer match this document.
    </p>
    <div class="hash">${escapeHtml(data.chainHash ?? '— no hash available —')}</div>
    <p class="muted" style="margin-top:10px">
      Generated ${escapeHtml(fmtDateLong(data.generatedAt))} · for booking
      ${escapeHtml(data.bookingId)}.
    </p>
  </div>

  <p class="muted" style="margin-top:24px">
    Issued at the request of the booking customer. Movvy retains these
    records for 1 year (see audit_logs retention). For longer-term records
    or law-enforcement requests, contact <a href="mailto:management@movvy.ca" style="color:#047857">management@movvy.ca</a>.
  </p>
</body>
</html>`;
}

export async function shareAuditPdf(data: AuditExportData): Promise<void> {
  const Print = await import('expo-print');
  const html = buildAuditHtml(data);
  const { uri } = await Print.printToFileAsync({ html });

  let target = uri;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const dir = FileSystem.cacheDirectory;
    if (dir) {
      const safeCode = (data.bookingShortCode || 'booking').replace(/[^A-Za-z0-9_-]/g, '');
      const path = `${dir}Movvy-Audit-${safeCode}.pdf`;
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      await FileSystem.copyAsync({ from: uri, to: path });
      target = path;
    }
  } catch {
    // fall through with the original uri
  }

  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(target, {
    mimeType: 'application/pdf',
    dialogTitle: `Movvy audit log ${data.bookingShortCode}`,
    UTI: 'com.adobe.pdf',
  });
}
