import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, getSession } from '../../src/shared/api/client.js';

beforeEach(() => {
  const values = new Map();
  globalThis.sessionStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
});

test('API discovery handles the new backend without replacing the existing session contract', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
  };
  try {
    const session = await getSession();
    assert.equal(session.user, null);
    assert.deepEqual(calls, ['/api/v1/auth/session']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cancellation retains keepalive after a token refresh', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'expired-fixture');
  sessionStorage.setItem('careerlens.backend.refresh-token', 'refresh-fixture');
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/v1/auth/refresh') {
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({ access_token: 'renewed-fixture', refresh_token: 'next-fixture' });
    }
    if (calls.length === 1) return Response.json({ detail: 'Expired' }, { status: 401 });
    return Response.json({ status: 'cancelled' });
  };
  try {
    const result = await api('/evaluations/run-1/cancel', {
      method: 'POST',
      body: {},
      keepalive: true,
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.keepalive, true);
    assert.equal(calls[2].options.keepalive, true);
    assert.equal(calls[2].options.headers.Authorization, 'Bearer renewed-fixture');
    assert.equal(sessionStorage.getItem('careerlens.backend.refresh-token'), 'next-fixture');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
