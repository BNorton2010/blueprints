import {generateKeyPair, exportSPKI, SignJWT} from 'jose';
const {publicKey, privateKey} = await generateKeyPair('RS256', {extractable: true});
export const issuer = 'https://clerk.app.test';
export const jwtKey = await exportSPKI(publicKey);
export const publishableKey = 'pk_test_' + Buffer.from('clerk.app.test$').toString('base64');
export async function token(userId = 'user_owner', overrides = {}, key = privateKey) {
  const time = Math.floor(Date.now() / 1000);
  const claims = {iss: issuer, sub: userId, sid: 'sess_fixture', azp: 'https://app.test', nbf: time - 1, iat: time, exp: time + 120, sts: 'active', ...overrides};
  for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
  return new SignJWT(claims).setProtectedHeader({alg: 'RS256', kid: 'fixture'}).sign(key);
}
export const tokens = {
  owner: await token(), one: await token('user_visitor_one'), two: await token('user_visitor_two'),
  quota: await token('user_quota_user'), other: await token('user_other_id')
};
export const authEnv = {CLERK_ISSUER: issuer, CLERK_JWT_KEY: jwtKey, CLERK_PUBLISHABLE_KEY: publishableKey, ADMIN_USER_IDS: 'user_owner'};
export const cookie = value => ({cookie: '__session=' + value});
