import {createRemoteJWKSet, importSPKI, jwtVerify} from 'jose';

// Configuration is trusted server configuration. Visitor headers never supply identity.
const verifiers = new Map();
export function clerkIssuer(env) {
  try {
    const url = new URL(env.CLERK_ISSUER);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}
export function authConfig(env) {
  const issuer = clerkIssuer(env);
  const key = env.CLERK_PUBLISHABLE_KEY;
  let domain;
  try { domain = atob(key?.replace(/^pk_(test|live)_/, '') || '').replace(/\$$/, ''); } catch {}
  const configured = !!issuer && /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(key || '') && domain === new URL(issuer).host;
  return configured ? {configured: true, publishableKey: key, scriptUrl: issuer + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js'} : {configured: false};
}
function sessionToken(request) {
  const authorization = request.headers.get('authorization');
  if (authorization) return /^Bearer [A-Za-z0-9_.-]+$/.test(authorization) ? authorization.slice(7) : null;
  const cookies = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith('__session='));
  // Ambiguous cookies must never select an identity based on header ordering.
  return cookies.length === 1 ? cookies[0].slice('__session='.length) : null;
}
function verifier(env, issuer) {
  const cacheKey = issuer + '\n' + (env.CLERK_JWT_KEY || '');
  if (!verifiers.has(cacheKey)) {
    if (verifiers.size >= 8) verifiers.clear();
    verifiers.set(cacheKey, env.CLERK_JWT_KEY ? importSPKI(env.CLERK_JWT_KEY.replace(/\\n/g, '\n'), 'RS256') : createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'), {timeoutDuration: 5000}));
  }
  return verifiers.get(cacheKey);
}
export async function authenticate(request, env) {
  const token = sessionToken(request), issuer = clerkIssuer(env);
  if (!token || token.length > 16384 || !issuer) return null;
  try {
    const {payload} = await jwtVerify(token, await verifier(env, issuer), {
      algorithms: ['RS256'], issuer, clockTolerance: 5,
      requiredClaims: ['sub', 'sid', 'exp', 'iat', 'nbf', 'azp'],
      ...(env.CLERK_AUDIENCE ? {audience: env.CLERK_AUDIENCE} : {})
    });
    const parties = new Set([new URL(request.url).origin, ...(env.CLERK_AUTHORIZED_PARTIES || '').split(',').map(s => s.trim()).filter(Boolean)]);
    if (!parties.has(payload.azp) || !/^user_[A-Za-z0-9_-]+$/.test(payload.sub) || !/^sess_[A-Za-z0-9_-]+$/.test(payload.sid) || !Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 5 || (payload.sts !== undefined && payload.sts !== 'active')) return null;
    return Object.freeze({userId: payload.sub, sessionId: payload.sid});
  } catch { return null; }
}
export function isAdmin(session, env) {
  return !!session?.userId && (env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(session.userId);
}
