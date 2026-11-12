import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/lib/api.js';

describe('api client', () => {
  it('sends CSRF and idempotency headers with JSON bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/checkout/sessions', { method: 'POST', body: { planId: 'pro-monthly' }, csrfToken: 'csrf-token', idempotencyKey: 'idem-key' });
    expect(fetchMock).toHaveBeenCalledWith('/api/checkout/sessions', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-token', 'Idempotency-Key': 'idem-key' },
      body: JSON.stringify({ planId: 'pro-monthly' }),
    }));
    vi.unstubAllGlobals();
  });

  it('surfaces structured API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'NO_BILLING_ACCOUNT', message: 'Complete a checkout first.' } }), { status: 409 })));
    await expect(api('/api/billing/portal', { method: 'POST' })).rejects.toMatchObject({ status: 409, code: 'NO_BILLING_ACCOUNT', message: 'Complete a checkout first.' });
    vi.unstubAllGlobals();
  });

  it('handles network failures without exposing internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(api('/api/plans')).rejects.toBeInstanceOf(ApiError);
    vi.unstubAllGlobals();
  });
});