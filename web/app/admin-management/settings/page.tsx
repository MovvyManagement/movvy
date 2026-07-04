// =============================================================================
// /admin-management/settings — management-only ops settings.
//
// Feature flags (toggle live) + promo codes (create + list). Reads go through
// the admin-console edge fn so they don't depend on browser-session RLS.
// =============================================================================

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getAdminAccess } from '@/lib/adminAccess';
import { fmtCents } from '@/lib/format';
import { toggleFlag } from './actions';
import { PromoForm } from './PromoForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  if ((await getAdminAccess(supabase)) !== 'management') redirect('/admin-management/dashboard');

  const [{ data: flagsRes }, { data: promosRes }] = await Promise.all([
    supabase.functions.invoke('admin-console', { body: { action: 'list_flags' } }),
    supabase.functions.invoke('admin-console', { body: { action: 'list_promos' } }),
  ]);
  const flags = (flagsRes?.flags ?? []) as any[];
  const promos = (promosRes?.promos ?? []) as any[];

  return (
    <div className="p-6 sm:p-8 max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Feature flags and promo codes. Changes are live immediately.</p>
      </div>

      {/* Feature flags */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-2">Feature flags</h2>
        <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-50">
          {flags.length === 0 ? (
            <div className="p-5 text-sm text-zinc-400">No feature flags defined.</div>
          ) : flags.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-zinc-900">{f.key}</div>
                {f.description ? <div className="text-xs text-zinc-400">{f.description}</div> : null}
              </div>
              <form action={toggleFlag}>
                <input type="hidden" name="key" value={f.key} />
                <input type="hidden" name="enabled" value={String(!f.enabled)} />
                <button className={`text-xs font-bold px-3 py-1.5 rounded-full ${f.enabled ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                  {f.enabled ? 'ON' : 'OFF'}
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>

      {/* Promo codes */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Promo codes</h2>
        <PromoForm />
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          {promos.length === 0 ? (
            <div className="p-5 text-sm text-zinc-400">No promo codes yet.</div>
          ) : promos.map((p, i) => (
            <div key={p.id} className={`flex items-center justify-between gap-4 px-5 py-3 ${i > 0 ? 'border-t border-zinc-50' : ''}`}>
              <div>
                <span className="font-mono text-sm font-bold text-zinc-900">{p.code}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {p.kind === 'percent_off' ? `${p.value}% off` : p.kind === 'amount_off_cents' ? `${fmtCents(p.value)} off` : 'Free service fee'}
                </span>
              </div>
              <span className={`text-xs font-bold ${p.is_active ? 'text-emerald-700' : 'text-zinc-400'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
