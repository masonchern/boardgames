/** Origins that may call this Worker from a browser. */
export function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://masonchern.github.io') return origin;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;
  if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return origin;
  return null;
}

export function corsHeaders(request, extra = {}) {
  const origin = allowedOrigin(request.headers.get('Origin'));
  return {
    'Access-Control-Allow-Origin': origin ?? 'https://masonchern.github.io',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    ...extra,
  };
}

export function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });
}

export function error(request, message, status = 400) {
  return json(request, { error: message }, status);
}
