// =============================================================================
// Tiny JSON-file persistence.
//
// Sample-grade only. Keeps two mappings on disk so restarts don't lose
// state while you're clicking through the flow:
//
//   • users           → array of { id, displayName, contactEmail, accountId }
//   • products        → array of { id, name, priceId, connectedAccountId }
//
// In a real Movvy integration, swap each get/save call for a Supabase
// query. The schema mirrors what you'd want on `partner_stripe_accounts`
// and `products`:
//
//   profiles.stripe_account_id  ← users[i].accountId
//   products.stripe_product_id  ← products[i].id
//   products.partner_id         ← whichever profile owns it
//
// We deliberately keep this code dumb so you can rip it out cleanly.
// =============================================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '..', 'data', 'db.json');

const emptyDb = { users: [], products: [] };

async function load() {
  if (!existsSync(DB_PATH)) {
    await mkdir(dirname(DB_PATH), { recursive: true });
    await writeFile(DB_PATH, JSON.stringify(emptyDb, null, 2));
    return structuredClone(emptyDb);
  }
  const raw = await readFile(DB_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return { ...emptyDb, ...parsed };
  } catch {
    // Corrupt file — start fresh rather than crash the server.
    return structuredClone(emptyDb);
  }
}

async function save(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── Users (platform partners who hold a connected account) ────────────────

export async function listUsers() {
  const db = await load();
  return db.users;
}

export async function getUser(id) {
  const db = await load();
  return db.users.find((u) => u.id === id) ?? null;
}

export async function getUserByAccountId(accountId) {
  const db = await load();
  return db.users.find((u) => u.accountId === accountId) ?? null;
}

export async function createUser({ displayName, contactEmail, accountId }) {
  const db = await load();
  const user = { id: randomUUID(), displayName, contactEmail, accountId };
  db.users.push(user);
  await save(db);
  return user;
}

// ─── Products ──────────────────────────────────────────────────────────────

export async function listProducts() {
  const db = await load();
  return db.products;
}

export async function createProduct({
  id,
  name,
  description,
  priceId,
  unitAmount,
  currency,
  connectedAccountId,
}) {
  const db = await load();
  const row = {
    id,
    name,
    description,
    priceId,
    unitAmount,
    currency,
    connectedAccountId,
  };
  db.products.push(row);
  await save(db);
  return row;
}

export async function getProduct(id) {
  const db = await load();
  return db.products.find((p) => p.id === id) ?? null;
}
