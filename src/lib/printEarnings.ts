// =============================================================================
// Driver earnings statement — on-device PDF + CSV export
//
// Mirrors printReceipt.ts: lazy-imports expo-print / expo-sharing /
// expo-file-system so it stays out of paths that don't touch the export.
//
// PDF path:  earnings statement HTML → printToFileAsync → renamed to
//            Movvy-Earnings-<period>.pdf in the cache dir → share sheet.
// CSV path:  rows joined in memory → writeAsStringAsync → share sheet.
//
// Both functions resolve once the share sheet is dismissed.
// =============================================================================

import {
  buildEarningsCsv,
  buildEarningsHtml,
  type EarningsStatementData,
} from './earnings';

function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Render the earnings statement to PDF and return its file:// URI. */
export async function generateEarningsPdf(data: EarningsStatementData): Promise<string> {
  const Print = await import('expo-print');
  const html = buildEarningsHtml(data);
  const { uri } = await Print.printToFileAsync({ html });

  try {
    const FileSystem = await import('expo-file-system/legacy');
    const dir = FileSystem.cacheDirectory;
    if (dir) {
      const target = `${dir}Movvy-Earnings-${safeFilename(data.periodLabel)}.pdf`;
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      await FileSystem.copyAsync({ from: uri, to: target });
      return target;
    }
  } catch {
    // fall through to the raw uri
  }
  return uri;
}

/** Generate + immediately share the PDF. */
export async function shareEarningsPdf(data: EarningsStatementData): Promise<void> {
  const uri = await generateEarningsPdf(data);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `Movvy earnings ${data.periodLabel}`,
    UTI: 'com.adobe.pdf',
  });
}

/** Write a CSV file to the cache dir and present the share sheet. */
export async function shareEarningsCsv(data: EarningsStatementData): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('No cache directory available');

  const target = `${dir}Movvy-Earnings-${safeFilename(data.periodLabel)}.csv`;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(target, buildEarningsCsv(data), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(target, {
    mimeType: 'text/csv',
    dialogTitle: `Movvy earnings ${data.periodLabel}`,
    UTI: 'public.comma-separated-values-text',
  });
}
