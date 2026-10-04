import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { z } from 'zod';
import { endpoint, HttpError, MAX_NOTE_BYTES } from '../shared';
import { authorise, rateLimit, secretMatches } from './auth';
import { GitHubVault } from './github';
import { deleteSchema, handleMcp, requestSync, writeSchema } from './mcp';
import { mirrorStatus } from './mirror';
import { searchNotes, searchSchema } from './search';
import type { Env } from './types';
export { MirrorCoordinator } from './mirror';
async function routes(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/authorize') return authorise(request,env);
  if (path === '/' && request.method === 'GET') return new Response('Obsidian Semantic Engine. Private notes on GitHub, searchable through authenticated MCP at /mcp. See https://github.com/krshirkoohi/obsidian-semantic-engine for installation and privacy details.', {headers:{'Content-Type':'text/plain; charset=utf-8'}});
  if (!path.startsWith('/api/')) return new Response('Not found',{status:404});
  if (!await secretMatches(request.headers.get('Authorization')?.replace(/^Bearer /,'') || '',env.SYNC_TOKEN)) throw new HttpError(401,'A valid device sync token is required.');
  if (path === '/api/config' && request.method === 'GET') return Response.json({repository:env.GITHUB_REPOSITORY,branch:env.GITHUB_BRANCH,excluded_prefixes:new GitHubVault(env).excluded,vault_name:env.VAULT_NAME});
  if (path === '/api/notes' && request.method === 'GET') return Response.json(await new GitHubVault(env).list());
  if (path === '/api/note' && request.method === 'GET') return Response.json(await new GitHubVault(env).read(url.searchParams.get('path') || ''));
  if (path === '/api/note' && request.method === 'PUT') {
    const body = writeSchema.parse(await request.json()), result = await new GitHubVault(env).write(body.path,body.content,body.expected_sha);
    requestSync(env,ctx); return Response.json(result);
  }
  if (path === '/api/note' && request.method === 'DELETE') {
    const body = deleteSchema.parse(await request.json()), result = await new GitHubVault(env).remove(body.path,body.expected_sha);
    requestSync(env,ctx); return Response.json(result);
  }
  if (path === '/api/search' && request.method === 'POST') return Response.json(await searchNotes(env,searchSchema.parse(await request.json())));
  if (path === '/api/status' && request.method === 'GET') return Response.json(await mirrorStatus(env));
  if (path === '/api/sync' && request.method === 'POST') { requestSync(env,ctx); return Response.json({queued:true},{status:202}); }
  return new Response('Not found',{status:404});
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    let response: Response;
    try {
      if (!env.PUBLIC_URL || !env.OWNER_PASSWORD || env.OWNER_PASSWORD.length<32 || !env.SYNC_TOKEN || env.SYNC_TOKEN.length<32) throw new HttpError(503,'Deployment is not configured.');
      const origin = endpoint(env.PUBLIC_URL), url = new URL(request.url);
      if (url.origin !== origin) throw new HttpError(421,'Use the configured server origin.');
      if (url.pathname === '/health' && request.method === 'GET') return Response.json({service:'obsidian-semantic-engine',version:'0.1.0',configured:true});
      if (request.headers.has('Origin') && request.headers.get('Origin') !== origin && request.headers.get('Origin') !== 'https://chatgpt.com') throw new HttpError(403,'Origin is not allowed.');
      // Read with an explicit limit, including requests that omit Content-Length.
      if (request.body) {
        const reader = request.body.getReader(); const parts: Uint8Array[] = []; let size=0;
        while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>MAX_NOTE_BYTES*2+8192) { await reader.cancel(); throw new HttpError(413,'Request is too large.'); } parts.push(value); }
        const body=new Uint8Array(size);let pos=0;for(const part of parts){body.set(part,pos);pos+=part.length;}
        request=new Request(request,{body});
      }
      if (request.method === 'POST' && ['/authorize','/oauth/register'].includes(url.pathname)) await rateLimit(request,env);
      const scopes=['notes:read','offline_access']; if(env.ENABLE_CHATGPT_WRITES==='true') scopes.push('notes:write');
      const provider = new OAuthProvider<Env>({
        apiRoute:'/mcp', apiHandler:{fetch:(req,bindings,context) => handleMcp(req,bindings,context,(context as any).auth?.scope || [])},
        defaultHandler:{fetch:routes}, authorizeEndpoint:'/authorize', tokenEndpoint:'/oauth/token', clientRegistrationEndpoint:'/oauth/register',
        scopesSupported:scopes, requiredScopes:['notes:read'], resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin]},
        clientIdMetadataDocumentEnabled:true, clientRegistrationTTL:undefined, accessTokenTTL:3600,refreshTokenTTL:2592000,
      });
      response=await provider.fetch(request,env,ctx);
    } catch(e) {
      response=Response.json({error:e instanceof HttpError?e.message:e instanceof z.ZodError?'Invalid request parameters.':'Request failed. Check server configuration and retry.'},{status:e instanceof HttpError?e.status:e instanceof z.ZodError||e instanceof SyntaxError?400:500});
    }
    const safe=new Response(response.body,response);
    safe.headers.set('Cache-Control','no-store');safe.headers.set('X-Content-Type-Options','nosniff');safe.headers.set('Referrer-Policy','no-referrer');safe.headers.set('X-Frame-Options','DENY');
    safe.headers.set('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    return safe;
  },
  async scheduled(_event: ScheduledController,env: Env,ctx: ExecutionContext) {
    requestSync(env,ctx);
    ctx.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(Date.now()).run());
  },
} satisfies ExportedHandler<Env>;
