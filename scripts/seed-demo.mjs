#!/usr/bin/env node
// =============================================================================
// Movvy — Demo seed script
//
// Creates 4 fully-wired demo accounts via Supabase's admin API, plus a
// partner team + a company so you can test every surface end-to-end:
//
//   • customer-demo@movvy.app    → customer (book a move)
//   • driver-demo@movvy.app      → driver on a 2-person team
//   • mover-demo@movvy.app       → mover on the same team
//   • company-demo@movvy.app     → owner of "Demo Movers Co."
//
// All four use the password:  MovvyDemo2026!
//
// The script is idempotent — running it twice is safe. It will skip any
// account that already exists and update the team/company links.
//
// Output prints:
//   • the credentials you need
//   • the team invite code (TM-XXXXXX)
//   • the company invite code (CO-XXXXXX) — required for company-demo to
//     pass the partner-signin code gate
//   • a sample customer booking id so you have something on the Moves tab
//
// HOW TO RUN:
//   1. Make sure .env.local has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      (the service-role key, NOT the publishable one — it's the long token
//      labelled "service_role" in your Supabase dashboard → Project Settings
//      → API). NEVER commit this key.
//   2. npm install @supabase/supabase-js dotenv
//   3. node scripts/seed-demo.mjs
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Load .env.local manually so we don't depend on dotenv being installed ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const URL =
  process.env.SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY) {
  console.error(`
✖  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.

   Add them to .env.local:
     SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

   The service-role key is in Supabase Dashboard → Project Settings → API,
   under "service_role" (NOT the anon/publishable key).
`);
  process.exit(1);
}

// ─── Production guard ────────────────────────────────────────────────────────
// This script creates demo accounts with a PUBLISHED shared password
// (see scripts/DEMO_CREDENTIALS.md) and auto-confirms their emails. Running it
// against production would seed known-credential logins into the live system.
// Refuse to touch the known prod project unless someone very deliberately sets
// SEED_ALLOW_PROD=1.
const PROD_PROJECT_REF = 'aabenjobueqawtyebirt';
const looksLikeProd = URL.includes(PROD_PROJECT_REF);
if (looksLikeProd && process.env.SEED_ALLOW_PROD !== '1') {
  console.error(`
✖  Refusing to seed demo accounts into PRODUCTION.

   Target URL points at the production project (${PROD_PROJECT_REF}).
   This script creates accounts with the shared demo password from
   scripts/DEMO_CREDENTIALS.md — never run it against live data.

   Point SUPABASE_URL at a local/staging project instead. If you truly
   mean to run it here, re-run with SEED_ALLOW_PROD=1 (you almost never do).
`);
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'MovvyDemo2026!';
const ACCOUNTS = [
  { email: 'customer-demo@movvy.app', name: 'Casey Customer',  role: 'customer' },
  { email: 'driver-demo@movvy.app',   name: 'Diego Driver',    role: 'driver' },
  { email: 'mover-demo@movvy.app',    name: 'Morgan Mover',    role: 'mover' },
  { email: 'company-demo@movvy.app',  name: 'Olivia Owner',    role: 'company_owner' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureUser({ email, name, role }) {
  // Try to look up first — admin.listUsers is paginated; we filter by email.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((u) => u.email === email);
  if (existing) {
    console.log(`  ↻ ${email} already exists (${existing.id.slice(0, 8)}…)`);
    return existing;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true, // skip the verification email for demo accounts
    user_metadata: { full_name: name, role },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  console.log(`  ✓ created ${email} (${data.user.id.slice(0, 8)}…)`);
  return data.user;
}

async function ensureProfile(user, name, role) {
  // Profile rows are normally created by the on_auth_user_created trigger
  // (migration 0006). We wait briefly, then fall back to inserting the
  // profile directly via service-role if the trigger never fired — this
  // makes the seed work even on databases where migration 0006 hasn't
  // been applied yet.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: p } = await admin
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (p) return p;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Trigger didn't fire — create the profile ourselves. We use upsert
  // with onConflict so re-running the seed is idempotent.
  const { data, error } = await admin
    .from('profiles')
    .upsert(
      {
        id: user.id,
        email: user.email,
        full_name: name,
        role,
      },
      { onConflict: 'id' },
    )
    .select()
    .maybeSingle();
  if (error) {
    console.warn(
      `  ⚠  Could not create profile for ${user.email}: ${error.message}. ` +
        `Apply migration 0006 (handle_new_user trigger) for automatic creation.`,
    );
    return null;
  }
  console.log(`  + manually created profile for ${user.email} (trigger missing)`);
  return data;
}

async function getCalgaryCityId() {
  // Try to look up Calgary first — migrations seed it in 0006/0014, but if
  // those didn't run, we insert it ourselves so the seed can keep going.
  const { data: existing } = await admin
    .from('cities')
    .select('id')
    .eq('slug', 'calgary')
    .maybeSingle();
  if (existing?.id) return existing.id;

  console.log('  + Calgary city row missing — creating it now…');
  const { data, error } = await admin
    .from('cities')
    .insert({
      slug: 'calgary',
      name: 'Calgary',
      country_code: 'CA',
      region: 'AB',
      timezone: 'America/Edmonton',
      center_lat: 51.0447,
      center_lng: -114.0719,
      bounds_n: 51.2125,
      bounds_s: 50.8425,
      bounds_e: -113.8585,
      bounds_w: -114.271,
      is_active: true,
      is_accepting_partners: true,
      launched_at: new Date().toISOString(),
      currency: 'CAD',
      commission_rate: 0.17,
      tax_rate: 0.05,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `Could not create Calgary city row: ${error?.message ?? 'unknown'}. ` +
        `Run your migrations (supabase db push) or insert the row manually in Supabase Studio.`,
    );
  }
  console.log(`  + Calgary city created (${data.id.slice(0, 8)}…)`);
  return data.id;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n→ Creating demo accounts (idempotent)…');
  const users = {};
  for (const acct of ACCOUNTS) {
    const u = await ensureUser(acct);
    await ensureProfile(u, acct.name, acct.role);
    users[acct.role] = u;
  }

  const cityId = await getCalgaryCityId();

  // ─── Partner team (Diego driver + Morgan mover) ────────────────────────
  console.log('\n→ Setting up partner team (Diego + Morgan)…');
  let team;
  const { data: existingTeam } = await admin
    .from('partner_teams')
    .select('id, invite_code, display_name')
    .eq('display_name', 'Demo Crew')
    .maybeSingle();
  if (existingTeam) {
    team = existingTeam;
    console.log(`  ↻ team "Demo Crew" already exists (${team.invite_code})`);
  } else {
    const { data, error } = await admin
      .from('partner_teams')
      .insert({
        display_name: 'Demo Crew',
        primary_city_id: cityId,
        onboarding_status: 'verified',
        verified_at: new Date().toISOString(),
      })
      .select('id, invite_code, display_name')
      .single();
    if (error) throw error;
    team = data;
    console.log(`  ✓ team created — invite code ${team.invite_code}`);
  }

  // Link driver + mover to the team
  for (const [profile, role, license] of [
    [users.driver, 'driver', 'AB-DEMO-001'],
    [users.mover,  'mover',  null],
  ]) {
    const { data: existing } = await admin
      .from('partner_team_members')
      .select('id')
      .eq('team_id', team.id)
      .eq('profile_id', profile.id)
      .maybeSingle();
    if (existing) continue;
    await admin.from('partner_team_members').insert({
      team_id: team.id,
      profile_id: profile.id,
      role,
      driver_license_number: license,
      accepted_at: new Date().toISOString(),
    });
    console.log(`  ✓ linked ${profile.email} as ${role}`);
  }

  // ─── Company (Olivia owns "Demo Movers Co.") ───────────────────────────
  console.log('\n→ Setting up company (Demo Movers Co.)…');
  let company;
  const { data: existingCo } = await admin
    .from('companies')
    .select('id, invite_code, display_name')
    .eq('legal_name', 'Demo Movers Co.')
    .maybeSingle();
  if (existingCo) {
    company = existingCo;
    console.log(`  ↻ company "Demo Movers Co." already exists (${company.invite_code})`);
  } else {
    const { data, error } = await admin
      .from('companies')
      .insert({
        legal_name: 'Demo Movers Co.',
        display_name: 'Demo Movers Co.',
        registration_number: 'DEMO-1234567',
        phone: '+14035550100',
        email: 'company-demo@movvy.app',
        primary_city_id: cityId,
        hq_line1: '100 9 Ave SW',
        hq_city_name: 'Calgary',
        hq_region: 'AB',
        hq_country_code: 'CA',
        hq_lat: 51.045,
        hq_lng: -114.069,
        onboarding_status: 'verified',
        verified_at: new Date().toISOString(),
        truck_count: 3,
      })
      .select('id, invite_code, display_name')
      .single();
    if (error) throw error;
    company = data;
    console.log(`  ✓ company created — invite code ${company.invite_code}`);
  }

  // Link Olivia as owner
  const { data: existingOwner } = await admin
    .from('company_members')
    .select('id')
    .eq('company_id', company.id)
    .eq('profile_id', users.company_owner.id)
    .maybeSingle();
  if (!existingOwner) {
    await admin.from('company_members').insert({
      company_id: company.id,
      profile_id: users.company_owner.id,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    });
    console.log(`  ✓ linked ${users.company_owner.email} as owner`);
  }

  // ─── Sample booking from Casey customer ────────────────────────────────
  console.log('\n→ Creating a sample searching booking for Casey…');
  const { data: existingBooking } = await admin
    .from('bookings')
    .select('id, short_code')
    .eq('customer_id', users.customer.id)
    .eq('status', 'searching')
    .maybeSingle();
  let booking;
  if (existingBooking) {
    booking = existingBooking;
    console.log(`  ↻ Casey already has a searching booking (#${booking.short_code})`);
  } else {
    const { data, error } = await admin
      .from('bookings')
      .insert({
        customer_id: users.customer.id,
        city_id: cityId,
        move_type: 'home_move',
        status: 'searching',
        pickup_line1: '425 1 Ave NE',
        pickup_city: 'Calgary',
        pickup_region: 'AB',
        pickup_country_code: 'CA',
        pickup_lat: 51.0537,
        pickup_lng: -114.0561,
        dropoff_line1: '2020 Memorial Dr NW',
        dropoff_city: 'Calgary',
        dropoff_region: 'AB',
        dropoff_country_code: 'CA',
        dropoff_lat: 51.0598,
        dropoff_lng: -114.094,
        scheduled_for_date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        scheduled_for_window: '9:00 AM – 11:00 AM',
        details: { moveType: 'home_move', dwelling: 'apartment', bedrooms: 2 },
        price_total_cents: 95000,
        price_subtotal_cents: 88000,
        price_tax_cents: 4400,
      })
      .select('id, short_code')
      .single();
    if (error) throw error;
    booking = data;
    console.log(`  ✓ created sample booking #${booking.short_code}`);
  }

  // ─── Summary ───────────────────────────────────────────────────────────
  console.log(`
================================================================
  ✓ Movvy demo seed ready

  Password for ALL four accounts:  ${PASSWORD}

  ╭─ CUSTOMER ────────────────────────────────────────────────╮
  │  email:    customer-demo@movvy.app                        │
  │  Sign in:  Welcome → "I already have an account"          │
  │  See:      Home (book a move), Moves tab, Profile         │
  │  Sample:   1 searching booking #${booking.short_code.padEnd(20, ' ')}      │
  ╰────────────────────────────────────────────────────────────╯

  ╭─ DRIVER  (2-person team — Demo Crew) ─────────────────────╮
  │  email:    driver-demo@movvy.app                          │
  │  Sign in:  Welcome → "Already a partner? Partner sign-in" │
  │  Code:     ${team.invite_code.padEnd(48, ' ')}│
  │  See:      Jobs · Active · Earnings · Profile             │
  ╰────────────────────────────────────────────────────────────╯

  ╭─ MOVER  (passenger view on Demo Crew) ────────────────────╮
  │  email:    mover-demo@movvy.app                           │
  │  Sign in:  Welcome → "Already a partner? Partner sign-in" │
  │  Code:     ${team.invite_code.padEnd(48, ' ')}│
  │  See:      Read-only mirror of the driver's active job    │
  ╰────────────────────────────────────────────────────────────╯

  ╭─ COMPANY OWNER  (Demo Movers Co.) ────────────────────────╮
  │  email:    company-demo@movvy.app                         │
  │  Sign in:  Welcome → "Already a partner? Partner sign-in" │
  │  Code:     ${company.invite_code.padEnd(48, ' ')}│
  │  See:      Dashboard · Dispatch · Jobs · Earnings · Company│
  ╰────────────────────────────────────────────────────────────╯

  Test addresses for the booking flow (or use the autocomplete):
    Pickup:   425 1 Ave NE, Calgary
    Drop-off: 2020 Memorial Dr NW, Calgary
    Other:    1234 Kensington Rd NW · 999 8 St SW · 5500 Macleod Trail SW

  Full credentials + addresses are also in scripts/DEMO_CREDENTIALS.md.
================================================================
`);
}

main().catch((e) => {
  console.error('\n✖ Seed failed:', e.message ?? e);
  process.exit(1);
});
