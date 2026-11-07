const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { segment } = require('../dist/nodes/Pewpros/helpers');
const { Pewpros } = require('../dist/nodes/Pewpros/Pewpros.node');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

test('segment encodes path-changing characters and refuses dot segments', () => {
  assert.equal(segment('42'), '42');
  assert.equal(segment('my-course'), 'my-course');
  assert.equal(
    segment('../admin/appointments/5/confirm?'),
    '..%2Fadmin%2Fappointments%2F5%2Fconfirm%3F',
  );
  assert.equal(segment('%2e%2e'), '%252e%252e');
  assert.equal(segment('a#b'), 'a%23b');
  for (const bad of ['', '.', '..', '  ', null, undefined]) {
    assert.throws(() => segment(bad, 'Conversation ID'), /Conversation ID is required/);
  }
});

/** Run the node once and return the URLs it fetched (and its output items). */
async function run(params) {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return new Response('{"data":{}}', { status: 200 });
  };
  const ctx = {
    getInputData: () => [{ json: {} }],
    getCredentials: async () => ({ baseUrl: 'https://dev.pewpros.com', apiToken: 't' }),
    getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
    getNode: () => ({ name: 'Pewpros', type: 'pewpros', typeVersion: 1, parameters: {} }),
    continueOnFail: () => true,
  };
  const [items] = await new Pewpros().execute.call(ctx);
  return { urls, items };
}

for (const [label, params] of [
  ['conversation mark read', { resource: 'conversation', operation: 'markRead', readBeforeId: '' }],
  ['conversation close (existing op)', { resource: 'conversation', operation: 'close' }],
  ['conversation get (existing op)', { resource: 'conversation', operation: 'get' }],
]) {
  test(`${label}: a traversal id cannot reach another route`, async () => {
    const { urls } = await run({ ...params, conversationId: '../admin/appointments/5/confirm?' });
    for (const url of urls) {
      const parsed = new URL(url);
      assert.ok(parsed.pathname.startsWith('/api/v1/conversations/'), parsed.pathname);
      assert.ok(!parsed.pathname.includes('/admin/'), parsed.pathname);
      assert.equal(parsed.search, '');
    }
  });

  test(`${label}: a dot-segment id is refused before any request`, async () => {
    const { urls, items } = await run({ ...params, conversationId: '..' });
    assert.equal(urls.length, 0);
    assert.match(items[0].json.error, /is required and cannot be/);
  });
}

test('contact delete with a traversal id stays on the contact route', async () => {
  const { urls } = await run({
    resource: 'contact',
    operation: 'delete',
    contactId: '1/../../admin/memberships/5/subscription/cancel',
  });
  assert.equal(urls.length, 1);
  assert.equal(
    new URL(urls[0]).pathname,
    '/api/v1/contacts/1%2F..%2F..%2Fadmin%2Fmemberships%2F5%2Fsubscription%2Fcancel',
  );
});

test('course slugs still work in paths', async () => {
  const { urls } = await run({ resource: 'course', operation: 'get', courseSlug: 'first-aid' });
  assert.equal(new URL(urls[0]).pathname, '/api/v1/courses/first-aid');
});
