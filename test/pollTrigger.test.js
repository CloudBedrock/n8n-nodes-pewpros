const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { PewprosPollTrigger } = require('../dist/nodes/Pewpros/PewprosPollTrigger.node');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

/** A minimal IPollFunctions over fixed parameters and shared static data. */
function pollContext(parameters, staticData) {
  return {
    getCredentials: async () => ({ baseUrl: 'https://dev.pewpros.com', apiToken: 't' }),
    getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
    getMode: () => 'trigger',
    getWorkflowStaticData: () => staticData,
    helpers: { returnJsonArray: (rows) => rows.map((json) => ({ json })) },
  };
}

test('registration polling advances the cursor and drops boundary duplicates', async () => {
  const trigger = new PewprosPollTrigger();
  const state = { lastUpdatedAt: '2026-11-07T10:00:00Z', seenIds: [4] };
  const requested = [];
  const pages = [
    [
      { id: 4, updated_at: '2026-11-07T10:00:00Z' },
      { id: 5, updated_at: '2026-11-07T10:00:00Z' },
      { id: 6, updated_at: '2026-11-07T10:05:00Z' },
      { id: 7, updated_at: '2026-11-07T10:05:00Z' },
    ],
    [
      { id: 6, updated_at: '2026-11-07T10:05:00Z' },
      { id: 7, updated_at: '2026-11-07T10:05:00Z' },
    ],
  ];
  global.fetch = async (url) => {
    requested.push(new URL(url));
    return new Response(JSON.stringify({ data: pages.shift() ?? [], meta: {} }), { status: 200 });
  };

  const context = pollContext(
    { event: 'registration', registrationFilters: { event_id: '10' } },
    state,
  );
  const first = await trigger.poll.call(context);
  assert.deepEqual(
    first[0].map((item) => item.json.id),
    [5, 6, 7],
  );
  assert.equal(requested[0].pathname, '/api/v1/admin/registrations');
  assert.equal(requested[0].searchParams.get('updated_since'), '2026-11-07T10:00:00Z');
  assert.equal(requested[0].searchParams.get('event_id'), '10');
  assert.deepEqual(state, { lastUpdatedAt: '2026-11-07T10:05:00Z', seenIds: [6, 7] });

  // Next poll returns only the boundary rows again: nothing new is emitted.
  const second = await trigger.poll.call(context);
  assert.equal(second, null);
  assert.equal(requested[1].searchParams.get('updated_since'), '2026-11-07T10:05:00Z');
});

test('course enrollment polling uses the site-wide admin list', async () => {
  const trigger = new PewprosPollTrigger();
  const state = { lastUpdatedAt: '2026-11-07T10:00:00Z', seenIds: [] };
  let requested;
  global.fetch = async (url) => {
    requested = new URL(url);
    return new Response(JSON.stringify({ data: [{ id: 1, updated_at: '2026-11-07T11:00:00Z' }] }), {
      status: 200,
    });
  };
  const result = await trigger.poll.call(
    pollContext({ event: 'courseEnrollment', enrollmentFilters: { course_id: '3' } }, state),
  );
  assert.equal(requested.pathname, '/api/v1/admin/courses/enrollments');
  assert.equal(requested.searchParams.get('course_id'), '3');
  assert.deepEqual(
    result[0].map((item) => item.json.id),
    [1],
  );
});
