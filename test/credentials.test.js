const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PewprosApi } = require('../dist/credentials/PewprosApi.credentials');
const { PewprosPartnerApi } = require('../dist/credentials/PewprosPartnerApi.credentials');

const cases = [
  {
    name: 'Partner',
    cred: new PewprosPartnerApi(),
    data: (baseUrl) => ({ partnerKey: 'sk_partner_x', baseUrl }),
    header: 'X-Partner-Key',
    value: 'sk_partner_x',
  },
  {
    name: 'Bearer',
    cred: new PewprosApi(),
    data: (baseUrl) => ({ apiToken: 'tok', baseUrl }),
    header: 'Authorization',
    value: 'Bearer tok',
  },
];

for (const c of cases) {
  test(`${c.name}: credential test request over https gets the header`, async () => {
    const out = await c.cred.authenticate(c.data('https://dev.pewpros.com'), {
      baseURL: 'https://dev.pewpros.com',
      url: '/api/v1/x',
      headers: { Accept: 'application/json' },
    });
    assert.equal(out.headers[c.header], c.value);
    assert.equal(out.headers.Accept, 'application/json');
  });

  test(`${c.name}: refuses an http:// base URL that is not loopback`, async () => {
    await assert.rejects(
      c.cred.authenticate(c.data('http://dev.pewpros.com'), {
        baseURL: 'http://dev.pewpros.com',
        url: '/api/v1/x',
      }),
      /insecure http:/,
    );
  });

  test(`${c.name}: refuses an HTTP Request node pointed at an http:// host`, async () => {
    await assert.rejects(
      c.cred.authenticate(c.data('https://dev.pewpros.com'), { url: 'http://evil.example.com/x' }),
      /insecure http:/,
    );
  });

  test(`${c.name}: refuses an https URL on another host`, async () => {
    await assert.rejects(
      c.cred.authenticate(c.data('https://dev.pewpros.com'), { url: 'https://attacker.example/x' }),
      /only signs requests to its Base URL/,
    );
  });

  test(`${c.name}: refuses the legacy uri option pointed at an http:// host`, async () => {
    await assert.rejects(
      c.cred.authenticate(c.data('https://dev.pewpros.com'), { uri: 'http://evil.example.com/x' }),
      /insecure http:/,
    );
  });

  test(`${c.name}: refuses a protocol-relative url to another host`, async () => {
    await assert.rejects(
      c.cred.authenticate(c.data('https://dev.pewpros.com'), {
        baseURL: 'https://dev.pewpros.com',
        url: '//evil.example.com/x',
      }),
      /only signs requests to its Base URL/,
    );
  });

  test(`${c.name}: allows an absolute https URL on its own Base URL`, async () => {
    const out = await c.cred.authenticate(c.data('https://dev.pewpros.com'), {
      url: 'https://dev.pewpros.com/api/v1/contacts',
    });
    assert.equal(out.headers[c.header], c.value);
  });

  test(`${c.name}: allows http://localhost`, async () => {
    const out = await c.cred.authenticate(c.data('http://localhost:4000'), {
      url: 'http://localhost:4000/api/v1/x',
    });
    assert.equal(out.headers[c.header], c.value);
  });

  test(`${c.name}: unresolved baseURL expression falls back to the stored Base URL`, async () => {
    await assert.rejects(
      c.cred.authenticate(c.data('http://dev.pewpros.com'), {
        baseURL: '={{$credentials.baseUrl}}',
        url: '/api/v1/x',
      }),
      /insecure http:/,
    );
  });
}
