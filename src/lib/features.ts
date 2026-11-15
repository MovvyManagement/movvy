// =============================================================================
// Feature switches — things that are built but deliberately turned off.
// =============================================================================

/**
 * Calling between a customer and their crew.
 *
 * Calls run through Movvy's Twilio number, which bridges the two sides so
 * neither sees the other's real phone number. On since Nov 2026, when Twilio
 * voice was connected. Set this to false to hide every call button and leave
 * chat as the only way to reach each other; the `twilio_proxy_enabled` flag in
 * the database is the server-side switch for the same thing. The website has
 * its own copy of this switch in web/lib/movvy.ts.
 *
 * This does not affect the Movvy support line or the 911 button on the safety
 * screens.
 */
export const CREW_CALLING_ENABLED: boolean = true;

/**
 * The Movvy support phone line, in full international form
 * (for example '+14035550123').
 *
 * null means there is no line yet. The app then shows no phone number
 * anywhere: support is chat and email, and the "Call Movvy" button on the
 * movers' safety screens becomes "Email Movvy". Put a real, answered number
 * here and the phone options all come back.
 */
export const SUPPORT_PHONE: string | null = null;

export const SUPPORT_EMAIL = 'support@movvy.ca';

/** The support line the way people write it, e.g. "+1 (403) 555-0123". */
export function supportPhoneLabel(): string | null {
  if (!SUPPORT_PHONE) return null;
  const digits = SUPPORT_PHONE.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return SUPPORT_PHONE;
}
