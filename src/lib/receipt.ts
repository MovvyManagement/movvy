// =============================================================================
// Customer receipt — shared HTML + data shape
//
// Source of truth for the receipt the customer sees the moment a move
// completes. Same HTML is rendered to PDF on-device via printReceipt.ts and
// — in legacy paths — emailed by the receipt-email edge function. Keep it
// framework-free so it runs in both contexts.
// =============================================================================

import { fmtCurrency, fmtDateLong } from './format';

export interface ReceiptLine {
  label: string;
  /** Customer-facing dollars (cents/100 already done by caller). */
  amount: number;
  /** Bold the line — used for the Total row. */
  emphasize?: boolean;
}

export interface ReceiptData {
  shortCode: string;
  customerName: string;
  customerEmail?: string;
  moveType: string;
  scheduledForDate: string;
  scheduledForWindow?: string;
  /** When the driver flagged drop-off complete. */
  completedAt: string;
  pickup: string;
  dropoff: string;
  lines: ReceiptLine[];
  /** Tip is shown separately so the customer can see the breakdown — if 0, hide. */
  tipDollars: number;
  totalDollars: number;
  /** Optional payment-method summary, e.g. "Visa ····4242". */
  paymentLabel?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch),
  );
}

export function buildReceiptHtml(data: ReceiptData): string {
  const lineRows = data.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.label)}</td>
        <td style="text-align:right;${l.emphasize ? 'font-weight:700' : ''}">${fmtCurrency(l.amount)}</td>
      </tr>`,
    )
    .join('');

  const tipRow =
    data.tipDollars > 0
      ? `<tr><td>Tip · 100% to crew</td><td style="text-align:right">${fmtCurrency(data.tipDollars)}</td></tr>`
      : '';

  const payment = data.paymentLabel
    ? `<div class="muted" style="margin-top:6px">Paid with ${escapeHtml(data.paymentLabel)}</div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Movvy Receipt ${escapeHtml(data.shortCode)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0A0A0A; padding: 32px; max-width: 640px; margin: 0 auto; }
  .brand { font-size: 28px; font-weight: 800; color: #047857; letter-spacing: -0.5px; }
  .muted { color: #71717A; font-size: 13px; }
  .card { border: 1px solid #E4E4E7; border-radius: 14px; padding: 20px; margin-top: 20px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717A; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 8px 0; border-bottom: 1px solid #F4F4F5; }
  td:last-child { white-space: nowrap; }
  .total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 18px; padding-top: 14px; border-top: 2px solid #0A0A0A; }
  .total .k { font-size: 14px; font-weight: 600; }
  .total .v { font-size: 28px; font-weight: 800; }
  .route { display: flex; gap: 12px; align-items: flex-start; }
  .route .dot { width: 10px; height: 10px; border-radius: 50%; background: #0A0A0A; margin-top: 6px; flex: 0 0 auto; }
  .route .dot.green { background: #16A34A; }
  .route .body { font-size: 14px; flex: 1; }
  .route .body .ln { font-weight: 600; }
</style>
</head>
<body>
  <div class="brand">Movvy</div>
  <div class="muted">Receipt · Booking #${escapeHtml(data.shortCode)}</div>
  ${payment}

  <div class="card">
    <h2>Move</h2>
    <div style="font-size:15px;font-weight:600">${escapeHtml(data.moveType)}</div>
    <div class="muted" style="margin-top:4px">
      Completed ${escapeHtml(fmtDateLong(data.completedAt))}${
    data.scheduledForWindow ? ' · scheduled ' + escapeHtml(data.scheduledForWindow) : ''
  }
    </div>

    <div style="margin-top:18px" class="route">
      <div class="dot"></div>
      <div class="body">
        <div class="ln">Pickup</div>
        <div class="muted">${escapeHtml(data.pickup)}</div>
      </div>
    </div>
    <div style="margin-top:10px" class="route">
      <div class="dot green"></div>
      <div class="body">
        <div class="ln">Drop-off</div>
        <div class="muted">${escapeHtml(data.dropoff)}</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Charges</h2>
    <table>
      <tbody>${lineRows}${tipRow}</tbody>
    </table>
    <div class="total">
      <div class="k">Total charged</div>
      <div class="v">${fmtCurrency(data.totalDollars)}</div>
    </div>
  </div>

  <p class="muted" style="margin-top:24px">
    Issued to ${escapeHtml(data.customerName)}${
    data.customerEmail ? ' · ' + escapeHtml(data.customerEmail) : ''
  }. Movvy Technologies Inc. · Calgary, AB. Questions? Reply to any move
    notification in the app or email <a href="mailto:support@movvy.ca" style="color:#047857">support@movvy.ca</a>.
  </p>
</body>
</html>`;
}
