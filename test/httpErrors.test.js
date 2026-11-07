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

test('lane_busy lists the free lanes', async () => {
  stub(409, {
    errors: [{ code: 'lane_busy', message: 'That lane is booked for part of that time.' }],
    lane_id: 4,
    free_lanes: [
      { id: 11, number: 3, name: 'Lane 3' },
      { id: 12, number: 5, name: 'VIP Bay' },
    ],
  });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/range/reservations', { body: {} }),
    (error) =>
      error.message ===
      'HTTP 409: That lane is booked for part of that time. [lane_busy]. ' +
        'Free lanes: #3 (id 11), #5 VIP Bay (id 12)',
  );
});

test('lane_busy with no free lanes says so', async () => {
  stub(409, {
    errors: [{ code: 'lane_busy', message: 'That lane is booked for part of that time.' }],
    free_lanes: [],
  });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/range/reservations/1/extend', { body: {} }),
    /No other lane is free then/,
  );
});

test('lane_blocked includes the staff alerts', async () => {
  stub(409, {
    errors: [
      {
        code: 'lane_blocked',
        message: 'A staff alert blocks lane assignment for this customer.',
      },
    ],
    alerts: [{ id: 1, body: 'Unsafe handling, see manager', severity: 'critical' }],
  });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/range/reservations', { body: {} }),
    (error) =>
      error.message.includes('[lane_blocked]') &&
      error.message.includes('Alerts: Unsafe handling, see manager (critical)'),
  );
});

test('a coded 422 shows message and code', async () => {
  stub(422, { errors: [{ code: 'slot_taken', message: 'That time is no longer available.' }] });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/appointments', { body: {} }),
    (error) => error.message === 'HTTP 422: That time is no longer available. [slot_taken]',
  );
});

test('a changeset entry with a field names the field', async () => {
  stub(422, { errors: [{ field: 'course_id', message: 'has already been taken' }] });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/membership-levels/3/courses', { body: {} }),
    (error) => error.message === 'HTTP 422: course_id has already been taken',
  );
  stub(422, {
    errors: [{ code: 'invalid', field: 'guest_phone', message: 'guest_phone is required' }],
  });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/range/reservations', { body: {} }),
    (error) => error.message === 'HTTP 422: guest_phone is required [invalid]',
  );
});

test("Phoenix's {errors: {detail}} shows the detail", async () => {
  stub(404, { errors: { detail: 'Not Found' } });
  await assert.rejects(
    http.request('GET', '/api/v1/admin/registrations/999'),
    (error) => error.message === 'HTTP 404: Not Found',
  );
});

test('a changeset error map is still shown as JSON', async () => {
  stub(422, { errors: { first_name: ["can't be blank"] } });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/courses/1/enrollments', { body: {} }),
    /first_name/,
  );
});

for (const [path, key] of [
  ['/api/v1/admin/appointments', 'calendar'],
  ['/api/v1/admin/range/board', 'range'],
  ['/api/v1/admin/memberships/5/subscription/hold', 'memberships'],
  ['/api/v1/admin/membership-levels', 'memberships'],
  ['/api/v1/admin/check-in/verify', 'classes.check_in'],
  ['/api/v1/admin/courses/enrollments', 'classes.manage_courses'],
  ['/api/v1/conversations/1/read', 'conversations'],
]) {
  test(`403 on ${path} names ${key}`, async () => {
    stub(403, denied);
    await assert.rejects(http.request('GET', path), (error) => error.message.includes(`(${key})`));
  });
}

test('a coded 403 from a controller is not mistaken for a capability denial', async () => {
  stub(403, { errors: [{ code: 'forbidden', message: "You don't have permission for that." }] });
  await assert.rejects(
    http.request('POST', '/api/v1/admin/memberships/5/subscription/hold', { body: {} }),
    (error) =>
      error.message.includes('is not allowed to call') && !error.message.includes('(memberships)'),
  );
});
