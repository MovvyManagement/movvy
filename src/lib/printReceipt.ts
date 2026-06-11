// =============================================================================
// Client-side PDF receipt generation
//
// Renders the same HTML produced by buildReceiptHtml() to a real PDF
// on-device via expo-print, then opens the share sheet (expo-sharing) so the
// customer can save it to Files, AirDrop it to their accountant, or email it
// themselves. No server round-trip, no email gateway — the PDF exists the
// moment the booking is confirmed.
//
// Accountants asked for *real* PDFs (the old flow only sent HTML email), so
// we go straight to a .pdf file with a human-readable name
// ("Movvy-Receipt-AB1234.pdf") instead of the random UUID expo-print emits.
//
// expo-print / expo-sharing / expo-file-system are lazy-imported so they
// never load on web or in code paths that don't touch the receipt.
// =============================================================================

import { buildReceiptHtml, type ReceiptData } from './receipt';

/**
 * Render the receipt to a PDF file on disk and return its file:// URI.
 * The file is renamed to Movvy-Receipt-<shortCode>.pdf when possible so the
 * saved/shared file has a sensible name.
 */
export async function generateReceiptPdf(data: ReceiptData): Promise<string> {
  const Print = await import('expo-print');
  const html = buildReceiptHtml(data);
  const { uri } = await Print.printToFileAsync({ html });

  // Best-effort rename to a friendly filename. If anything goes wrong we
  // still return the original (working) URI — a randomly-named PDF beats no
  // PDF at all.
  try {
    // SDK 54: the classic file API lives under the /legacy entry point.
    const FileSystem = await import('expo-file-system/legacy');
    const dir = FileSystem.cacheDirectory;
    if (dir) {
      const safeCode = (data.shortCode || 'receipt').replace(/[^A-Za-z0-9_-]/g, '');
      const target = `${dir}Movvy-Receipt-${safeCode}.pdf`;
      // Remove any stale copy from a previous generation, then copy.
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      await FileSystem.copyAsync({ from: uri, to: target });
      return target;
    }
  } catch {
    // fall through to the raw uri
  }
  return uri;
}

/**
 * Generate the PDF and immediately present the native share sheet so the
 * customer can save it to Files / email it / AirDrop it. Resolves once the
 * sheet is dismissed. Throws if sharing isn't available on the platform.
 */
export async function shareReceiptPdf(data: ReceiptData): Promise<void> {
  const uri = await generateReceiptPdf(data);
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `Movvy receipt ${data.shortCode}`,
    UTI: 'com.adobe.pdf',
  });
}
