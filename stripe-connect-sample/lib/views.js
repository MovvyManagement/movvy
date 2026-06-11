// =============================================================================
// HTML view templates.
//
// Plain template literals — no React, no JSX, no build step. Styles use
// Movvy's brand palette (white background, green primary #16A34A, deep
// accent #047857, ink text #0A0A0A, silver dividers) and the same
// rounded-corner aesthetic from the mobile app.
//
// `layout(title, body)` wraps each page in the shared shell so every
// route gets the same header, nav, and footer.
// =============================================================================

// Tiny escape so user-supplied strings (display names, product names) can't
// inject HTML. Sufficient for a sample.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

export function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)} · Movvy Connect Sample</title>
  <style>
    :root {
      --ink: #0A0A0A;
      --ink-700: #2A2A2A;
      --silver-50: #FAFAFA;
      --silver-100: #F4F4F5;
      --silver-200: #E4E4E7;
      --silver-300: #D4D4D8;
      --silver-500: #71717A;
      --brand: #16A34A;
      --brand-deep: #047857;
      --brand-50: #ECFDF5;
      --brand-100: #D1FAE5;
      --danger: #EF4444;
      --warning: #F59E0B;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #FFFFFF;
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.5;
    }
    a { color: var(--brand-deep); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 32px 24px 80px; }
    header {
      border-bottom: 1px solid var(--silver-200);
      background: linear-gradient(180deg, var(--brand-50) 0%, #FFFFFF 100%);
    }
    header .wrap { padding: 24px; display: flex; align-items: center; justify-content: space-between; }
    .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }
    .logo-mark {
      width: 32px; height: 32px; border-radius: 10px; background: var(--brand);
      display: inline-flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; font-size: 14px;
    }
    nav a { margin-left: 16px; font-weight: 600; color: var(--ink); font-size: 14px; }
    nav a:hover { color: var(--brand-deep); }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 28px 0 12px; }
    p.lede { color: var(--silver-500); margin: 0 0 24px; }
    .card {
      border: 1px solid var(--silver-200);
      border-radius: 20px;
      padding: 20px;
      margin-bottom: 16px;
      background: #fff;
    }
    .card h3 { margin: 0 0 6px; font-size: 16px; }
    .meta { color: var(--silver-500); font-size: 13px; }
    label { display: block; font-weight: 600; font-size: 13px; margin: 12px 0 6px; }
    input, textarea, select {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--silver-300);
      border-radius: 14px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--brand);
      box-shadow: 0 0 0 3px var(--brand-100);
    }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .row > * { flex: 1; min-width: 180px; }
    button, .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      background: var(--brand);
      color: #fff;
      border: 0;
      padding: 12px 20px;
      border-radius: 14px;
      font: 600 14px/1 inherit;
      cursor: pointer;
      text-decoration: none;
    }
    button:hover, .btn:hover { background: var(--brand-deep); text-decoration: none; }
    button:disabled { background: var(--silver-300); cursor: not-allowed; }
    .btn.ghost { background: var(--silver-100); color: var(--ink); }
    .btn.ghost:hover { background: var(--silver-200); }
    .pill {
      display: inline-block; padding: 4px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 700;
    }
    .pill.ok { background: var(--brand-100); color: var(--brand-deep); }
    .pill.pending { background: #FEF3C7; color: #92400E; }
    .pill.warn { background: #FEE2E2; color: #991B1B; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .product {
      border: 1px solid var(--silver-200);
      border-radius: 20px;
      padding: 18px;
      background: #fff;
      display: flex; flex-direction: column; gap: 8px;
    }
    .product .price { font-size: 22px; font-weight: 800; color: var(--ink); }
    .product .seller { color: var(--silver-500); font-size: 12px; }
    footer { color: var(--silver-500); font-size: 12px; text-align: center; padding: 32px; }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
      font-size: 13px;
      background: var(--silver-100);
      padding: 2px 6px;
      border-radius: 6px;
    }
    pre { padding: 12px; overflow-x: auto; }
    .empty { padding: 40px; text-align: center; color: var(--silver-500); }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="logo">
        <span class="logo-mark">M</span>
        <span>Movvy Connect Sample</span>
      </div>
      <nav>
        <a href="/">Home</a>
        <a href="/onboard">Onboard</a>
        <a href="/products">Products</a>
        <a href="/storefront">Storefront</a>
      </nav>
    </div>
  </header>
  <div class="wrap">${body}</div>
  <footer>Stripe Connect · destination charges · platform fees collected by Movvy</footer>
</body>
</html>`;
}

// ─── Home ──────────────────────────────────────────────────────────────────

export function homeView({ users, products }) {
  return layout(
    'Home',
    `
    <h1>Movvy Connect Sample</h1>
    <p class="lede">A reference Stripe Connect integration that onboards partners as V2 connected accounts, lets them list products, and runs purchases as destination charges so Movvy keeps a platform fee.</p>

    <div class="card">
      <h3>How this works</h3>
      <ol>
        <li><a href="/onboard">Onboard a partner</a> — creates a V2 connected account with recipient capability, then sends them through Stripe's hosted onboarding.</li>
        <li><a href="/products">Create a product</a> — products live on the platform; the connected-account owner is stored in metadata.</li>
        <li><a href="/storefront">Visit the storefront</a> — a customer buys a product; payment is a destination charge that lands on the right partner with Movvy's fee deducted.</li>
      </ol>
    </div>

    <h2>State</h2>
    <div class="row">
      <div class="card"><h3>${users.length}</h3><div class="meta">connected accounts</div></div>
      <div class="card"><h3>${products.length}</h3><div class="meta">products listed</div></div>
    </div>
  `,
  );
}

// ─── Onboard ───────────────────────────────────────────────────────────────

export function onboardView({ users, statuses, error }) {
  // statuses keyed by user.id → { readyToReceivePayments, onboardingComplete, requirementsStatus }
  const userRows =
    users.length === 0
      ? `<div class="empty">No connected accounts yet. Use the form below to add one.</div>`
      : users
          .map((u) => {
            const s = statuses[u.id] ?? {};
            const ready = s.readyToReceivePayments;
            const done = s.onboardingComplete;
            const statusPill = ready
              ? `<span class="pill ok">Accepting payments</span>`
              : done
              ? `<span class="pill pending">Onboarded · finishing review</span>`
              : `<span class="pill warn">${esc(
                  s.requirementsStatus
                    ? `Action required (${s.requirementsStatus})`
                    : 'Onboarding not started',
                )}</span>`;
            return `
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
                <div>
                  <h3>${esc(u.displayName)}</h3>
                  <div class="meta">${esc(u.contactEmail)}</div>
                  <div class="meta" style="margin-top:4px"><code>${esc(u.accountId)}</code></div>
                </div>
                <div style="text-align:right">
                  ${statusPill}
                  <form action="/onboard/link" method="post" style="margin-top:12px">
                    <input type="hidden" name="userId" value="${esc(u.id)}" />
                    <button type="submit">${ready ? 'Update details' : 'Onboard to collect payments'}</button>
                  </form>
                </div>
              </div>
            </div>`;
          })
          .join('');

  return layout(
    'Onboard',
    `
    <h1>Onboard partners</h1>
    <p class="lede">Each partner gets their own V2 connected account. Status is fetched live from the Accounts API on every load — nothing is cached locally.</p>

    ${error ? `<div class="card" style="border-color:var(--danger);background:#FEF2F2"><strong>Error:</strong> ${esc(error)}</div>` : ''}

    <h2>Connected accounts</h2>
    ${userRows}

    <h2>Add a partner</h2>
    <div class="card">
      <form action="/onboard/create" method="post">
        <label for="displayName">Display name</label>
        <input id="displayName" name="displayName" placeholder="Calgary Couch Movers" required />

        <label for="contactEmail">Contact email</label>
        <input id="contactEmail" name="contactEmail" type="email" placeholder="dispatch@example.com" required />

        <div style="margin-top:16px">
          <button type="submit">Create connected account</button>
        </div>
        <p class="meta" style="margin-top:8px">Creates the account in test mode — country defaults to <code>us</code>, dashboard <code>express</code>, fees + losses collected by Movvy.</p>
      </form>
    </div>
  `,
  );
}

// ─── Products ──────────────────────────────────────────────────────────────

export function productsView({ users, products, error }) {
  const userOptions =
    users.length === 0
      ? `<option value="">No connected accounts — onboard one first</option>`
      : users
          .map(
            (u) =>
              `<option value="${esc(u.accountId)}">${esc(u.displayName)} (${esc(
                u.accountId,
              )})</option>`,
          )
          .join('');

  const productRows =
    products.length === 0
      ? `<div class="empty">No products yet.</div>`
      : products
          .map((p) => {
            const owner = users.find((u) => u.accountId === p.connectedAccountId);
            return `
            <div class="card">
              <h3>${esc(p.name)}</h3>
              <div class="meta">${esc(p.description ?? '')}</div>
              <div style="margin-top:8px"><strong>${(p.unitAmount / 100).toFixed(2)} ${esc(
                p.currency.toUpperCase(),
              )}</strong></div>
              <div class="meta" style="margin-top:4px">Seller: ${esc(
                owner?.displayName ?? p.connectedAccountId,
              )}</div>
              <div class="meta"><code>${esc(p.id)}</code></div>
            </div>`;
          })
          .join('');

  return layout(
    'Products',
    `
    <h1>Products</h1>
    <p class="lede">Products are created at the platform level. Each one is tagged in metadata with the connected account it pays out to.</p>

    ${error ? `<div class="card" style="border-color:var(--danger);background:#FEF2F2"><strong>Error:</strong> ${esc(error)}</div>` : ''}

    <h2>Add a product</h2>
    <div class="card">
      <form action="/products/create" method="post">
        <label for="name">Name</label>
        <input id="name" name="name" placeholder="Studio move · ~2 hrs" required />

        <label for="description">Description</label>
        <textarea id="description" name="description" rows="2" placeholder="Two movers, one truck, hourly billing."></textarea>

        <div class="row">
          <div>
            <label for="unitAmount">Price (cents)</label>
            <input id="unitAmount" name="unitAmount" type="number" min="1" placeholder="17500" required />
          </div>
          <div>
            <label for="currency">Currency</label>
            <input id="currency" name="currency" value="usd" required />
          </div>
        </div>

        <label for="connectedAccountId">Connected account (the partner who gets paid)</label>
        <select id="connectedAccountId" name="connectedAccountId" required>${userOptions}</select>

        <div style="margin-top:16px">
          <button type="submit" ${users.length === 0 ? 'disabled' : ''}>Create product</button>
        </div>
      </form>
    </div>

    <h2>All products</h2>
    <div class="grid">${productRows}</div>
  `,
  );
}

// ─── Storefront ────────────────────────────────────────────────────────────

export function storefrontView({ users, products }) {
  const cards =
    products.length === 0
      ? `<div class="empty">No products listed yet. Create one on the <a href="/products">Products</a> page.</div>`
      : products
          .map((p) => {
            const owner = users.find((u) => u.accountId === p.connectedAccountId);
            return `
            <div class="product">
              <h3>${esc(p.name)}</h3>
              <div class="meta">${esc(p.description ?? '')}</div>
              <div class="price">${(p.unitAmount / 100).toFixed(2)} ${esc(
                p.currency.toUpperCase(),
              )}</div>
              <div class="seller">Sold by ${esc(owner?.displayName ?? 'partner')}</div>
              <form action="/checkout" method="post" style="margin-top:auto">
                <input type="hidden" name="productId" value="${esc(p.id)}" />
                <button type="submit">Buy</button>
              </form>
            </div>`;
          })
          .join('');

  return layout(
    'Storefront',
    `
    <h1>Storefront</h1>
    <p class="lede">Every product on the platform. Clicking Buy opens a Stripe Checkout session — the charge is a destination charge that lands on the seller's connected account with Movvy's platform fee deducted.</p>
    <div class="grid">${cards}</div>
  `,
  );
}

// ─── Post-checkout ─────────────────────────────────────────────────────────

export function successView({ session }) {
  return layout(
    'Thanks',
    `
    <h1>Thanks for your order</h1>
    <p class="lede">Checkout session <code>${esc(session.id)}</code> completed with status <strong>${esc(
      session.payment_status,
    )}</strong>.</p>
    <div class="card">
      <h3>Total</h3>
      <p>${(session.amount_total / 100).toFixed(2)} ${esc(
        (session.currency ?? 'usd').toUpperCase(),
      )}</p>
      <h3>Receipt</h3>
      <p class="meta">Stripe emailed a receipt to <code>${esc(
        session.customer_details?.email ?? 'the buyer',
      )}</code>.</p>
    </div>
    <p><a class="btn ghost" href="/storefront">Back to storefront</a></p>
  `,
  );
}

export function errorView(message) {
  return layout(
    'Error',
    `
    <h1>Something went wrong</h1>
    <div class="card" style="border-color:var(--danger);background:#FEF2F2">
      <pre>${esc(message)}</pre>
    </div>
    <p><a class="btn ghost" href="/">Home</a></p>
  `,
  );
}
