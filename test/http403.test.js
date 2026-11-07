const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { PewprosHttp } = require('../dist/utils/PewprosHttp');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function stub(status, body) {
  global.fetch = async () => new Response(JSON.stringify(body), { status });
}

const http = new PewprosHttp({ baseUrl: 'https://dev.pewpros.com', apiToken: 't' });
const denied = { errors: [{ message: 'Your role does not have access' }] };

test('webhook registration 403 names the integrations permission', async () => {
  stub(403, denied);
  await assert.rejects(
    http.request('POST', '/api/v1/webhooks/register', { body: {} }),
    (error) =>
      error.message.startsWith('HTTP 403') &&
      error.message.includes('"Integrations and credentials" (setup.integrations)') &&
      error.message.includes('POST /api/v1/webhooks/register') &&
      error.message.includes('Your role does not have access'),
  );
});

test('admin registrations 403 names classes.registrations', async () => {
  stub(403, denied);
  await assert.rejects(
    http.request('POST', '/api/v1/admin/registrations/invite'),
    /classes\.registrations/,
  );
});

test('admin event attendees 403 names classes', async () => {
  stub(403, denied);
  await assert.rejects(
    http.request('GET', '/api/v1/admin/events/5/attendees'),
    /\(classes\) permission/,
  );
});

test('unmapped 403 gives a generic role message', async () => {
  stub(403, { errors: [{ message: 'Forbidden' }] });
  await assert.rejects(
    http.request('GET', '/api/v1/contacts'),
    /HTTP 403: the API token's role is not allowed to call GET \/api\/v1\/contacts.*Forbidden/,
  );
});

test('404 keeps the HTTP 404 prefix the trigger relies on', async () => {
  stub(404, { errors: [{ message: 'Not found' }] });
  await assert.rejects(http.request('GET', '/api/v1/webhooks/9'), /^Error: HTTP 404: Not found$/);
});
