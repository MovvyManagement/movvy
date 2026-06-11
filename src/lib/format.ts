export const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 }).format(n);

export const fmtDistance = (km: number) => `${km.toFixed(1)} km`;

export const fmtDuration = (min: number) => {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} hr` : `${h}h ${m}m`;
};

export const fmtDateShort = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
};

export const fmtDateLong = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

/** Compact "time since" label for presence/last-seen ("just now", "5m ago",
 *  "2h ago", "3d ago", else a short date). Returns 'never' for empty input. */
export const fmtRelativeAgo = (iso: string | null | undefined): string => {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDateShort(iso);
};

export const initials = (name: string) => {
  // Fallback display values like "Welcome" / "Movvy customer" shouldn't
  // surface as their literal first letter on the avatar — they aren't a
  // real name. We bounce those to the Movvy mark fallback handled by
  // <Avatar />, returning empty here so the caller can branch.
  const generic = new Set(['welcome', 'movvy customer', 'movvy partner', 'movvy']);
  if (!name || generic.has(name.trim().toLowerCase())) return '';
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

/** Format an E.164 NANP number (+1XXXYYYZZZZ) as (XXX) YYY-ZZZZ.
 *  Anything that doesn't look like NANP is returned untouched. */
export const fmtPhone = (raw: string | null | undefined): string => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  // Strip leading 1 for NANP so we always work on the 10-digit local number.
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
};

/** Pull the first name out of a full name, returning a friendly fallback
 *  when the source is empty / a generic placeholder. */
export const firstNameOf = (full: string | null | undefined, fallback = 'there'): string => {
  const v = (full ?? '').trim();
  if (!v) return fallback;
  if (v.toLowerCase() === 'welcome') return fallback;
  const first = v.split(/\s+/)[0];
  return first || fallback;
};
