// =============================================================================
// Driver / partner earnings statement
//
// Tax season needs a real document, not a screen. This module produces:
//   • buildEarningsHtml() — a print-ready statement (→ PDF via expo-print)
//   • buildEarningsCsv()  — a spreadsheet-friendly export an accountant can
//                           drop straight into bookkeeping software
//
// Both are framework-free (no RN, no JSX) so they run in the app bundle AND
// server-side if we ever want to email a year-end summary. The on-device
// PDF/CSV share flow lives in printEarnings.ts.
//
// Movvy issues these as an informational summary of platform payouts. It is
// NOT an official CRA T4A — drivers are independent contractors responsible
// for their own filings — but it gives them (and their accountant) every
// number they need in one place.
// =============================================================================

import { fmtCurrency, fmtDateLong } from './format';

export interface EarningsLineItem {
  /** ISO date the job completed. */
  date: string;
  shortCode: string;
  /** Human label, e.g. "Calgary → Airdrie" or just the pickup city. */
  route: string;
  /** Gross the job billed out at (driver's share before Movvy's fee). */
  grossCents: number;
  /** Movvy platform fee withheld. */
  feeCents: number;
  /** Net actually paid out to the driver/team. */
  netCents: number;
}

export interface EarningsStatementData {
  partnerName: string;
  /** e.g. "2026" or "Jan 1 – Dec 31, 2026". */
  periodLabel: string;
  jobs: EarningsLineItem[];
  totalGrossCents: number;
  totalFeeCents: number;
  totalNetCents: number;
  /** ISO timestamp the statement was generated. */
  generatedAt: string;
}

/**
 * Roll a list of completed-job line items up into a full statement, summing
 * the totals so callers don't have to. Jobs are sorted oldest → newest.
 */
export function buildEarningsStatement(
  partnerName: string,
  periodLabel: string,
  jobs: EarningsLineItem[],
): EarningsStatementData {
  const sorted = [...jobs].sort((a, b) => a.date.localeCompare(b.date));
  const totalGrossCents = sorted.reduce((s, j) => s + j.grossCents, 0);
  const totalFeeCents = sorted.reduce((s, j) => s + j.feeCents, 0);
  const totalNetCents = sorted.reduce((s, j) => s + j.netCents, 0);
  return {
    partnerName,
    periodLabel,
    jobs: sorted,
    totalGrossCents,
    totalFeeCents,
    totalNetCents,
    generatedAt: new Date().toISOString(),
  };
}

/** Spreadsheet export — one row per completed job, plus a totals row. */
export function buildEarningsCsv(data: EarningsStatementData): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const c = (cents: number) => (cents / 100).toFixed(2);
  const header = ['Date', 'Booking', 'Route', 'Gross', 'Movvy fee', 'Net payout'];
  const rows = data.jobs.map((j) =>
    [j.date, j.shortCode, j.route, c(j.grossCents), c(j.feeCents), c(j.netCents)]
      .map(esc)
      .join(','),
  );
  const totals = [
    `Total (${data.jobs.length} jobs)`,
    '',
    '',
    c(data.totalGrossCents),
    c(data.totalFeeCents),
    c(data.totalNetCents),
  ]
    .map(esc)
    .join(',');
  return [header.map(esc).join(','), ...rows, totals].join('\n');
}

/** Print-ready HTML earnings statement (rendered to PDF on-device). */
export function buildEarningsHtml(data: EarningsStatementData): string {
  const rows = data.jobs
    .map(
      (j) => `<tr>
        <td>${escapeHtml(j.date)}</td>
        <td>${escapeHtml(j.shortCode)}</td>
        <td>${escapeHtml(j.route)}</td>
        <td style="text-align:right">${fmtCurrency(j.grossCents / 100)}</td>
        <td style="text-align:right">-${fmtCurrency(j.feeCents / 100)}</td>
        <td style="text-align:right;font-weight:700">${fmtCurrency(j.netCents / 100)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Movvy Earnings ${escapeHtml(data.periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0A0A0A; padding: 32px; max-width: 760px; margin: 0 auto; }
  .brand { font-size: 28px; font-weight: 800; color: #047857; letter-spacing: -0.5px; }
  .muted { color: #71717A; font-size: 13px; }
  .card { border: 1px solid #E4E4E7; border-radius: 14px; padding: 20px; margin-top: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #71717A; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; padding: 0 0 8px; border-bottom: 1px solid #E4E4E7; }
  td { padding: 8px 0; border-bottom: 1px solid #F4F4F5; }
  .totals { display: flex; gap: 12px; margin-top: 16px; }
  .totbox { flex: 1; border: 1px solid #E4E4E7; border-radius: 12px; padding: 14px; }
  .totbox .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #71717A; }
  .totbox .v { font-size: 20px; font-weight: 800; margin-top: 4px; }
  .net .v { color: #047857; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #71717A; margin: 0 0 12px; }
</style>
</head>
<body>
  <div class="brand">Movvy</div>
  <div class="muted">Earnings statement · ${escapeHtml(data.periodLabel)}</div>
  <div class="muted">${escapeHtml(data.partnerName)}</div>

  <div class="totals">
    <div class="totbox"><div class="k">Gross</div><div class="v">${fmtCurrency(
      data.totalGrossCents / 100,
    )}</div></div>
    <div class="totbox"><div class="k">Movvy fees</div><div class="v">-${fmtCurrency(
      data.totalFeeCents / 100,
    )}</div></div>
    <div class="totbox net"><div class="k">Net payout</div><div class="v">${fmtCurrency(
      data.totalNetCents / 100,
    )}</div></div>
  </div>

  <div class="card">
    <h2>Completed jobs (${data.jobs.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Booking</th><th>Route</th>
          <th style="text-align:right">Gross</th>
          <th style="text-align:right">Fee</th>
          <th style="text-align:right">Net</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <p class="muted" style="margin-top:24px">
    Generated ${escapeHtml(fmtDateLong(data.generatedAt))} · Movvy Technologies Inc. ·
    Calgary, AB. This is an informational summary of platform payouts, not an
    official CRA tax slip. Drivers are independent contractors responsible for
    their own filings.
  </p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}
