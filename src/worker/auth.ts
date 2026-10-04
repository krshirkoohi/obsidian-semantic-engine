import { AuthorizationError, CimdFetchError, type ConsentDescription } from '@cloudflare/workers-oauth-provider';
import { digest, HttpError } from '../shared';
import type { Env } from './types';
export async function secretMatches(value: string, expected: string): Promise<boolean> {
  if (!expected || expected.length < 32 || value.length > 512) return false;
  const [a,b] = await Promise.all([digest(value), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function page(details: ConsentDescription, handle: string, writes: boolean): string {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Semantic Engine</title>
<body><main><h1>Connect your notes</h1><p><strong>${e(details.clientName)}</strong> requests access to this vault.</p>
<p>${details.clientDomain ? 'Client domain: ' + e(details.clientDomain) : 'This client name is self-registered and is not verified.'}</p>
<p>Access returns to <strong>${e(details.redirectHost)}</strong>.</p>${details.redirectIsLoopback ? '<p>This connects an app on your computer. Continue only if you started this connection.</p>' : ''}
<form method="post"><input type="hidden" name="handle" value="${e(handle)}">
<p><label>Owner connection password<br><input name="password" type="password" required autocomplete="current-password" size="40"></label></p>
<p><label><input type="checkbox" checked disabled> Read and search notes</label></p>
${writes ? '<p><label><input type="checkbox" name="write" value="yes"> Allow note creation, editing and deletion</label></p>' : ''}
<p>ChatGPT receives the notes returned by tools. GitHub stores note history. Cloudflare stores the search mirror and processes embeddings.</p>
<button name="decision" value="approve">Connect</button> <button name="decision" value="deny" formnovalidate>Cancel</button></form></main></body></html>`;
}
export async function authorise(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(auth);
      const consent = await oauth.beginConsent(auth);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      consent.headers.set('Cache-Control', 'no-store');
      return new Response(page(details, consent.handle, env.ENABLE_CHATGPT_WRITES === 'true'), { headers: consent.headers });
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    if (request.headers.get('Origin') !== env.PUBLIC_URL) throw new HttpError(403, 'Invalid form origin.');
    const form = await request.formData(), handle = String(form.get('handle') || '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (!await secretMatches(String(form.get('password') || ''), env.OWNER_PASSWORD)) throw new HttpError(401, 'Incorrect connection password.');
    const scopes = ['notes:read', 'offline_access'];
    if (form.get('write') === 'yes' && env.ENABLE_CHATGPT_WRITES === 'true') scopes.push('notes:write');
    const approved = await oauth.approveConsent(request, handle, { scope: scopes });
    const { redirectTo } = await oauth.completeAuthorization({ request: approved.request, userId: 'vault-owner', metadata: { label: 'Semantic Engine' }, scope: approved.request.scope, props: { userId: 'vault-owner' } });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof CimdFetchError) return Response.json({ error: 'The connection request is invalid, expired or already used. Start the connection again.' }, { status: 400 });
    throw e;
  }
}
export async function rateLimit(request: Request, env: Env) {
  const bucket = Math.floor(Date.now() / 60000);
  const key = await digest(`${env.OWNER_PASSWORD}:${request.headers.get('CF-Connecting-IP') || 'unknown'}:${new URL(request.url).pathname}:${bucket}`);
  const row = await env.DB.prepare('INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, (bucket + 2)*60000).first<{count: number}>();
  if ((row?.count || 0) > 20) throw new HttpError(429, 'Too many connection attempts. Retry in one minute.');
}
