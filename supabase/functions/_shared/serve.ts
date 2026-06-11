// Tiny shim so edge functions can register a handler the same way regardless of
// which Deno runtime version Supabase ships with. Use:
//
//   import { handle } from '../_shared/serve.ts';
//   handle(async (req) => { ... });

export function handle(handler: (req: Request) => Promise<Response> | Response) {
  // @ts-ignore — Deno global exists at runtime
  if (typeof Deno?.serve === 'function') {
    // @ts-ignore
    Deno.serve(handler);
    return;
  }
  import('https://deno.land/std@0.220.1/http/server.ts').then(({ serve }) => {
    serve(handler);
  });
}
