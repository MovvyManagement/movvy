// CORS headers — restricted to known origins in production.

const ALLOWED_ORIGINS = [
  'https://movvy.ca',
  'https://admin.movvy.ca',
  'https://www.movvy.ca',
  'http://localhost:3000',   // Next.js landing dev
  'http://localhost:8081',   // Expo dev
  'http://localhost:19006',
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-app, x-app-version',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
