import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, mutationHeaders, registerUser, TEST_ORIGIN, TEST_PASSWORD } from './helpers.js';

let context: Awaited<ReturnType<typeof createTestContext>> | undefined;
afterEach(async () => { await context?.close(); context = undefined; });

describe('authentication and request security', () => {
  it('rejects weak passwords and untrusted origins', async () => {
    context = await createTestContext();
    await context.agent.post('/api/auth/register').set('Origin', TEST_ORIGIN).send({ email: 'weak@example.com', password: 'short' }).expect(422);
    await context.agent.post('/api/auth/register').set('Origin', 'https://evil.example').send({ email: 'weak@example.com', password: TEST_PASSWORD }).expect(403);
  });

  it('creates an HttpOnly session, requires CSRF, and invalidates logout', async () => {
    context = await createTestContext();
    const response = await context.agent.post('/api/auth/register').set('Origin', TEST_ORIGIN).send({ email: 'customer@example.com', password: TEST_PASSWORD }).expect(201);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(response.body.user.email).toBe('customer@example.com');
    await context.agent.get('/api/auth/me').expect(200);
    await context.agent.post('/api/auth/logout').set('Origin', TEST_ORIGIN).expect(403);
    await context.agent.post('/api/auth/logout').set(mutationHeaders(response.body.csrfToken)).expect(204);
    await context.agent.get('/api/auth/me').expect(401);
  });

  it('rejects duplicate registration and invalid credentials without exposing details', async () => {
    context = await createTestContext();
    await registerUser(context.agent);
    const duplicate = await context.agent.post('/api/auth/register').set('Origin', TEST_ORIGIN).send({ email: 'customer@example.com', password: TEST_PASSWORD }).expect(409);
    expect(duplicate.body.error.code).toBe('EMAIL_REGISTERED');
    const invalid = await context.agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).send({ email: 'customer@example.com', password: 'wrong-password-123' }).expect(401);
    expect(invalid.body.error.message).toBe('The email or password is incorrect.');
    await context.agent.post('/api/auth/login').set('Origin', TEST_ORIGIN).send({ email: 'customer@example.com', password: TEST_PASSWORD }).expect(200);
  });

  it('protects billing endpoints and exposes health/readiness', async () => {
    context = await createTestContext();
    await context.agent.get('/api/orders').expect(401);
    await context.agent.get('/api/health').expect(200);
    const ready = await context.agent.get('/api/ready').expect(200);
    expect(ready.body.gateway).toBe('demo');
    await context.agent.get('/api/missing').expect(404);
  });
});