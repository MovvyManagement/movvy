// =============================================================================
// Customer receipt — shared HTML + data shape
//
// Source of truth for the receipt the customer sees the moment a move
// completes. Same HTML is rendered to PDF on-device via printReceipt.ts.
// Movvy does NOT email receipts — they're accessible inside the app and
// shareable via the native share sheet (Files, AirDrop, email yourself,
// forward to your accountant). Keep this framework-free so it runs in
// both expo-print (mobile PDF generation) and any future web-render path.
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
  /** Optional driver/crew name to show on the receipt. */
  crewName?: string;
  /** Hours billed (informational — shown if present). */
  billedHours?: number;
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

// Inline SVG logo — same truck + pin mark used on the landing page. Embedded
// directly so the PDF renders identically offline (no network fetch).
const LOGO_SVG = `
<svg viewBox="0 0 100 100" width="44" height="44" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" rx="22" fill="#0E9F6E"/>
  <rect x="20" y="40" width="38" height="35" rx="3.5" fill="white"/>
  <line x1="39" y1="40" x2="39" y2="75" stroke="#D1FAE5" stroke-width="1.5"/>
  <text x="39.5" y="62" text-anchor="middle" fill="#047857" font-weight="800" font-size="9.5" font-family="Helvetica, Arial, sans-serif">Movvy</text>
  <path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill="white"/>
  <path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0"/>
  <circle cx="32" cy="78" r="6.2" fill="#1F2937"/>
  <circle cx="70" cy="78" r="6.2" fill="#1F2937"/>
  <rect x="18" y="73" width="64" height="2.5" rx="1" fill="#A7F3D0"/>
  <circle cx="76" cy="22" r="10" fill="white"/>
  <path d="M76 32 L72 38 L80 38 Z" fill="white"/>
  <circle cx="76" cy="22" r="4.2" fill="#0E9F6E"/>
</svg>
`;

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

  const crewLine = data.crewName
    ? `<div class="muted" style="margin-top:4px">Crew: ${escapeHtml(data.crewName)}</div>`
    : '';

  const hoursLine =
    data.billedHours != null
      ? `<div class="muted" style="margin-top:4px">${data.billedHours.toFixed(2)} hours on site</div>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Movvy Receipt ${escapeHtml(data.shortCode)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif;
    color: #0A0A0A;
    padding: 40px;
    max-width: 720px;
    margin: 0 auto;
    background: #FFFFFF;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 2px solid #047857;
    padding-bottom: 20px;
  }
  .header .brand-row { display: flex; align-items: center; gap: 14px; }
  .brand {
    font-size: 30px;
    font-weight: 800;
    color: #047857;
    letter-spacing: -0.6px;
  }
  .doc-title { text-align: right; }
  .doc-title .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #71717A;
    font-weight: 700;
  }
  .doc-title .num {
    font-size: 18px;
    font-weight: 800;
    color: #0A0A0A;
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .muted { color: #71717A; font-size: 13px; }
  .card {
    border: 1px solid #E4E4E7;
    border-radius: 14px;
    padding: 20px;
    margin-top: 18px;
  }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #71717A;
    margin: 0 0 12px;
    font-weight: 700;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  td { padding: 9px 0; border-bottom: 1px solid #F4F4F5; }
  td:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 18px;
    padding-top: 14px;
    border-top: 2px solid #0A0A0A;
  }
  .total .k { font-size: 13px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: #71717A; }
  .total .v { font-size: 30px; font-weight: 800; color: #0A0A0A; font-variant-numeric: tabular-nums; }
  .route { display: flex; gap: 12px; align-items: flex-start; }
  .route .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #0A0A0A;
    margin-top: 6px;
    flex: 0 0 auto;
  }
  .route .dot.green { background: #16A34A; }
  .route .body { font-size: 14px; flex: 1; }
  .route .body .ln { font-weight: 700; margin-bottom: 2px; }
  .route .connector {
    width: 2px;
    background: #D4D4D8;
    margin: 4px 0 4px 4px;
    height: 18px;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 4px;
  }
  .meta-grid .item .k {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #71717A;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .meta-grid .item .v { font-size: 14px; font-weight: 600; color: #0A0A0A; }
  .footer {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid #E4E4E7;
    font-size: 12px;
    color: #71717A;
    line-height: 1.6;
  }
  .footer .bizline {
    color: #0A0A0A;
    font-weight: 600;
    margin-bottom: 4px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="brand-row">
      ${LOGO_SVG}
      <div>
        <div class="brand">Movvy</div>
        <div class="muted" style="margin-top:-2px">Alberta's moving marketplace</div>
      </div>
    </div>
    <div class="doc-title">
      <div class="label">Receipt</div>
      <div class="num">#${escapeHtml(data.shortCode)}</div>
    </div>
  </div>

  <div class="card">
    <div class="meta-grid">
      <div class="item">
        <div class="k">Issued To</div>
        <div class="v">${escapeHtml(data.customerName)}</div>
        ${data.customerEmail ? `<div class="muted" style="margin-top:2px">${escapeHtml(data.customerEmail)}</div>` : ''}
      </div>
      <div class="item">
        <div class="k">Date Completed</div>
        <div class="v">${escapeHtml(fmtDateLong(data.completedAt))}</div>
        ${data.scheduledForWindow ? `<div class="muted" style="margin-top:2px">Scheduled ${escapeHtml(data.scheduledForWindow)}</div>` : ''}
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Move Details</h2>
    <div style="font-size:16px;font-weight:700;text-transform:capitalize">${escapeHtml(data.moveType)}</div>
    ${crewLine}
    ${hoursLine}

    <div style="margin-top:18px" class="route">
      <div class="dot"></div>
      <div class="body">
        <div class="ln">Pickup</div>
        <div class="muted">${escapeHtml(data.pickup)}</div>
      </div>
    </div>
    <div class="connector"></div>
    <div class="route">
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
      <div class="k">Total Charged</div>
      <div class="v">${fmtCurrency(data.totalDollars)}</div>
    </div>
    ${payment}
  </div>

  <div class="footer">
    <div class="bizline">Movvy Technologies Inc.</div>
    Calgary, AB, Canada · GST/HST #XXXXXXXXX RT0001<br/>
    This is your official receipt for accounting and tax purposes. Movvy doesn't
    email receipts — you can always re-download this PDF inside the Movvy app
    under Profile → Receipts. Questions: <a href="mailto:support@movvy.ca" style="color:#047857;text-decoration:none">support@movvy.ca</a>.
  </div>
</body>
</html>`;
}
