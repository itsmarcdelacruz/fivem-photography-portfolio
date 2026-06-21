import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Back the worker with a single shared in-memory libSQL client so state persists
// across the per-request createClient() calls inside the worker.
vi.mock('@libsql/client/web', async () => {
  const { createClient } = await import('@libsql/client');
  const shared = createClient({ url: ':memory:' });
  return { createClient: () => shared };
});

import { createClient } from '@libsql/client/web';
import worker from '../src/index.js';

const PASSWORD = 'correct-horse-battery';
const env = {
  TURSO_URL: 'libsql://test',
  TURSO_TOKEN: 'test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  ADMIN_PASSWORD: PASSWORD,
  R2_PUBLIC_URL: 'https://r2.example',
  R2: { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
};

function req(method, path, { body, token, origin } = {}, customEnv = env) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (origin) headers['Origin'] = origin;
  return worker.fetch(
    new Request('https://api.test' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),
    customEnv
  );
}

async function adminToken() {
  const res = await req('POST', '/api/login', { body: { password: PASSWORD } });
  return (await res.json()).token;
}

const db = () => createClient();

beforeAll(async () => {
  // Trigger lazy migrations.
  await req('GET', '/api/photos');
});

beforeEach(async () => {
  for (const t of ['photos', 'commissions', 'shoots', 'settings', 'rate_limits']) {
    await db().execute('DELETE FROM ' + t);
  }
  env.R2.put.mockClear();
  env.R2.delete.mockClear();
});

describe('migrations', () => {
  it('creates all required tables', async () => {
    const { rows } = await db().execute("SELECT name FROM sqlite_master WHERE type='table'");
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['photos', 'commissions', 'shoots', 'settings', 'rate_limits'])
    );
  });
});

describe('auth', () => {
  it('logs in with the correct password', async () => {
    const res = await req('POST', '/api/login', { body: { password: PASSWORD } });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await req('POST', '/api/login', { body: { password: 'nope' } });
    expect(res.status).toBe(401);
  });

  it('blocks gated routes without a token', async () => {
    const res = await req('GET', '/api/commissions');
    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const res = await req('GET', '/api/commissions', { token: 'not.a.jwt' });
    expect(res.status).toBe(401);
  });

  it('allows gated routes with a valid token', async () => {
    const res = await req('GET', '/api/commissions', { token: await adminToken() });
    expect(res.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('429s after the commission threshold', async () => {
    const body = { name: 'A', contact: 'x' };
    for (let i = 0; i < 3; i++) {
      expect((await req('POST', '/api/commissions', { body })).status).toBe(201);
    }
    expect((await req('POST', '/api/commissions', { body })).status).toBe(429);
  });
});

describe('commissions (public POST)', () => {
  it('requires name and contact', async () => {
    expect((await req('POST', '/api/commissions', { body: { name: 'A' } })).status).toBe(400);
    expect((await req('POST', '/api/commissions', { body: { contact: 'x' } })).status).toBe(400);
  });

  it('rejects over-long fields', async () => {
    const base = { name: 'A', contact: 'x' };
    expect(
      (await req('POST', '/api/commissions', { body: { ...base, notes: 'n'.repeat(2001) } })).status
    ).toBe(400);
    expect(
      (await req('POST', '/api/commissions', { body: { ...base, refs: 'r'.repeat(501) } })).status
    ).toBe(400);
    expect(
      (await req('POST', '/api/commissions', { body: { ...base, name: 'n'.repeat(121) } })).status
    ).toBe(400);
  });

  it('stores a valid commission', async () => {
    const res = await req('POST', '/api/commissions', {
      body: { name: 'Jane', contact: 'jane#1234' }
    });
    expect(res.status).toBe(201);
    const { rows } = await db().execute('SELECT name, contact, status FROM commissions');
    expect(rows[0].name).toBe('Jane');
    expect(rows[0].status).toBe('new');
  });
});

describe('commission status + archive', () => {
  async function newCommission() {
    await req('POST', '/api/commissions', { body: { name: 'Jane', contact: 'x' } });
    const list = await (await req('GET', '/api/commissions', { token: await adminToken() })).json();
    return list.commissions[0].id;
  }

  it('rejects an invalid status', async () => {
    const id = await newCommission();
    const res = await req(
      'PATCH',
      '/api/commissions/' + id,
      { body: { status: 'bogus' }, token: await adminToken() }
    );
    expect(res.status).toBe(400);
  });

  it('archives a commission so it drops out of the list', async () => {
    const id = await newCommission();
    const token = await adminToken();
    expect((await req('POST', '/api/commissions/' + id + '/archive', { token })).status).toBe(200);
    const list = await (await req('GET', '/api/commissions', { token })).json();
    expect(list.commissions).toHaveLength(0);
  });
});

describe('promote + delete cascade', () => {
  async function promoted() {
    const token = await adminToken();
    await req('POST', '/api/commissions', { body: { name: 'Jane', contact: 'x' } });
    const list = await (await req('GET', '/api/commissions', { token })).json();
    const id = list.commissions[0].id;
    const res = await req('POST', '/api/commissions/' + id + '/promote', { token });
    return { token, id, res };
  }

  it('creates a booked shoot and marks the commission promoted', async () => {
    const { res } = await promoted();
    expect(res.status).toBe(201);
    const { rows } = await db().execute('SELECT status, source FROM shoots');
    expect(rows[0].status).toBe('booked');
    expect(rows[0].source).toBe('inbox');
  });

  it('refuses to promote twice', async () => {
    const { token, id } = await promoted();
    const res = await req('POST', '/api/commissions/' + id + '/promote', { token });
    expect(res.status).toBe(409);
  });

  it('404s promoting a missing commission', async () => {
    const res = await req('POST', '/api/commissions/does-not-exist/promote', {
      token: await adminToken()
    });
    expect(res.status).toBe(404);
  });

  it('archives the linked shoot when deleting a promoted commission', async () => {
    const { token, id } = await promoted();
    expect((await req('DELETE', '/api/commissions/' + id, { token })).status).toBe(200);
    const { rows } = await db().execute('SELECT status FROM shoots');
    // No orphan left active.
    expect(rows.every((r) => r.status === 'archived')).toBe(true);
  });
});

describe('photos', () => {
  const valid = {
    title: 'Shot',
    thumb_url: 'https://r2.example/photos/thumb/a.webp',
    full_url: 'https://r2.example/photos/full/a.webp'
  };

  it('requires title, thumb_url and full_url', async () => {
    const res = await req('POST', '/api/photos', {
      body: { title: 'x' },
      token: await adminToken()
    });
    expect(res.status).toBe(400);
  });

  it('auto-increments sort_order', async () => {
    const token = await adminToken();
    await req('POST', '/api/photos', { body: valid, token });
    await req('POST', '/api/photos', { body: { ...valid, title: 'Shot 2' }, token });
    const { rows } = await db().execute('SELECT sort_order FROM photos ORDER BY sort_order');
    expect(rows.map((r) => Number(r.sort_order))).toEqual([0, 1]);
  });

  it('rejects a patch with no fields', async () => {
    const token = await adminToken();
    const { id } = await (await req('POST', '/api/photos', { body: valid, token })).json();
    const res = await req('PATCH', '/api/photos/' + id, { body: {}, token });
    expect(res.status).toBe(400);
  });

  it('deletes the row and both R2 objects', async () => {
    const token = await adminToken();
    const { id } = await (await req('POST', '/api/photos', { body: valid, token })).json();
    const res = await req('DELETE', '/api/photos/' + id, { token });
    expect(res.status).toBe(200);
    expect(env.R2.delete).toHaveBeenCalledTimes(2);
    const { rows } = await db().execute('SELECT * FROM photos');
    expect(rows).toHaveLength(0);
  });

  it('404s deleting a missing photo', async () => {
    const res = await req('DELETE', '/api/photos/missing', { token: await adminToken() });
    expect(res.status).toBe(404);
  });
});

describe('shoots', () => {
  it('requires name and contact', async () => {
    const res = await req('POST', '/api/shoots', { body: { name: 'A' }, token: await adminToken() });
    expect(res.status).toBe(400);
  });

  it('normalizes the date to 10 chars', async () => {
    const token = await adminToken();
    await req('POST', '/api/shoots', {
      body: { name: 'A', contact: 'x', date: '2026-07-15T10:00:00Z' },
      token
    });
    const { rows } = await db().execute('SELECT date FROM shoots');
    expect(rows[0].date).toBe('2026-07-15');
  });

  it('enforces the status allowlist on patch', async () => {
    const token = await adminToken();
    const { id } = await (
      await req('POST', '/api/shoots', { body: { name: 'A', contact: 'x' }, token })
    ).json();
    const res = await req('PATCH', '/api/shoots/' + id, { body: { status: 'bogus' }, token });
    expect(res.status).toBe(400);
  });
});

describe('settings', () => {
  it('upserts and reads back', async () => {
    const token = await adminToken();
    await req('PUT', '/api/settings', { body: { available: 'true', badge: 'Open' }, token });
    const out = await (await req('GET', '/api/settings')).json();
    expect(out).toMatchObject({ available: 'true', badge: 'Open' });
  });
});

describe('CORS + security headers', () => {
  it('reflects an allowed origin and omits a foreign one', async () => {
    const lockedEnv = { ...env, ALLOWED_ORIGINS: 'https://katie.example' };
    const ok = await req('GET', '/api/photos', { origin: 'https://katie.example' }, lockedEnv);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://katie.example');

    const foreign = await req('GET', '/api/photos', { origin: 'https://evil.example' }, lockedEnv);
    expect(foreign.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
  });

  it('sets security headers on responses', async () => {
    const res = await req('GET', '/api/photos');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('answers OPTIONS preflight with allowed methods', async () => {
    const res = await req('OPTIONS', '/api/photos');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('routing', () => {
  it('404s an unknown path', async () => {
    const res = await req('GET', '/api/nope');
    expect(res.status).toBe(404);
  });
});
