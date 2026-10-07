import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair} from 'jose';
import {authenticate, authConfig} from '../worker/auth.js';
import {authEnv, token, cookie} from './auth-fixture.mjs';
const request = value => new Request('https://app.test/api/session', {headers: cookie(value)});
test('valid independent Clerk JWT establishes the verified stable account', async () => {
  const session = await authenticate(request(await token()), authEnv);
  assert.deepEqual(session, {userId: 'user_owner', sessionId: 'sess_fixture'});
  const bearer = new Request('https://app.test', {headers: {authorization: 'Bearer ' + await token()}});
  assert.equal((await authenticate(bearer, authEnv)).userId, 'user_owner');
});
test('signature, expiry, not-before, issuer, azp, missing claims and pending MFA are verified', async () => {
  const time = Math.floor(Date.now() / 1000);
  const invalid = [{exp: time - 60}, {nbf: time + 60}, {iat: time + 60}, {iss: 'https://attacker.test'}, {azp: 'https://attacker.test'}, {sub: undefined}, {sid: undefined}, {exp: undefined}, {nbf: undefined}, {iat: undefined}, {azp: undefined}, {sts: 'pending'}, {sub:'not_a_clerk_user'}];
  for (const claims of invalid) assert.equal(await authenticate(request(await token('user_owner', claims)), authEnv), null, JSON.stringify(claims));
  const {privateKey} = await generateKeyPair('RS256');
  assert.equal(await authenticate(request(await token('user_owner', {}, privateKey)), authEnv), null);
  assert.equal(await authenticate(request('not.a.jwt'), authEnv), null);
});
test('configured audience is required and cannot be bypassed', async () => {
  const env = {...authEnv, CLERK_AUDIENCE: 'blueprints'};
  assert.equal(await authenticate(request(await token()), env), null);
  assert.equal(await authenticate(request(await token('user_owner', {aud:'another-app'})), env), null);
  assert.equal((await authenticate(request(await token('user_owner', {aud:'blueprints'})), env)).userId, 'user_owner');
});
test('additional authorized parties must be explicitly configured', async () => {
  const value = await token('user_owner', {azp:'https://blueprints-dev.workers.dev'});
  assert.equal(await authenticate(request(value), authEnv), null);
  assert.equal((await authenticate(request(value), {...authEnv, CLERK_AUTHORIZED_PARTIES:'https://blueprints-dev.workers.dev'})).userId, 'user_owner');
});
test('configuration errors and ambiguous cookies fail closed without bypass modes', async () => {
  const value = await token();
  assert.equal(await authenticate(request(value), {}), null);
  assert.equal(await authenticate(request(value), {...authEnv,CLERK_ISSUER:'http://clerk.app.test'}), null);
  assert.equal(await authenticate(new Request('https://app.test',{headers:{cookie:'__session='+value+'; __session='+value}}), authEnv), null);
  assert.deepEqual(authConfig({}),{configured:false});
  assert.deepEqual(authConfig({...authEnv,CLERK_PUBLISHABLE_KEY:'pk_test_invalid'}),{configured:false});
});
