// =============================================================================
// edgeError — turn a supabase-js function error into something a human can act on.
//
// supabase-js wraps EVERY non-2xx from an edge function as a FunctionsHttpError
// whose message is the infamous "Edge Function returned a non-2xx status code".
// The actual reason ("Your truck registration is waiting on Movvy approval",
// "Job was already taken") is in error.context — the raw, unread Response. Any
// mutation that surfaces its failure to a user must go through this.
// =============================================================================

export async function edgeError(error: unknown, fallback = 'Something went wrong. Try again.'): Promise<Error> {
  const ctx = (error as any)?.context;
  try {
    if (ctx?.json) {
      const body = await ctx.json();
      const detail = body?.error ?? body?.message ?? body?.reason;
      if (detail) return new Error(String(detail));
    } else if (ctx?.text) {
      const text = await ctx.text();
      if (text) return new Error(text);
    }
  } catch {
    /* body wasn't JSON / already consumed — fall through */
  }
  const msg = (error as any)?.message;
  // Never let the wrapper's own message reach a user.
  if (msg && !/non-2xx status code/i.test(msg)) return new Error(String(msg));
  return new Error(fallback);
}
