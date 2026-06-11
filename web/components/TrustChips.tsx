// Tiny row of trust indicators that sit just below the hero CTA. These
// mirror what the mobile app advertises (insured, vetted, top-rated) and
// double as quick-scan reassurance before the visitor decides to download.

interface Chip {
  icon: React.ReactNode;
  label: string;
  sub: string;
}

const chips: Chip[] = [
  {
    icon: <StarIcon />,
    label: '4.9★',
    sub: 'Customer rating',
  },
  {
    icon: <ShieldIcon />,
    label: '$2M',
    sub: 'Damage coverage',
  },
  {
    icon: <CheckIcon />,
    label: 'Vetted',
    sub: 'Background-checked crews',
  },
];

export function TrustChips({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 ${className}`}>
      {chips.map((c) => (
        <div key={c.label} className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            {c.icon}
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-ink-900">{c.label}</p>
            <p className="text-[11px] text-silver-500">{c.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2L4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9 16.2L4.8 12l-1.4 1.4L9 19l12-12-1.4-1.4z" />
    </svg>
  );
}
