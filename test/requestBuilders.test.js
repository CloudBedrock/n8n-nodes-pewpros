const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildAppointmentRequest } = require('../dist/nodes/Pewpros/resources/appointment');
const {
  buildRangeReservationRequest,
  flattenBoard,
} = require('../dist/nodes/Pewpros/resources/rangeReservation');
const { buildRegistrationRequest } = require('../dist/nodes/Pewpros/resources/registration');
const { buildMembershipLevelRequest } = require('../dist/nodes/Pewpros/resources/membershipLevel');
const {
  buildMembershipSubscriptionRequest,
} = require('../dist/nodes/Pewpros/resources/membershipSubscription');
const { buildCheckInRequest } = require('../dist/nodes/Pewpros/resources/checkIn');
const { buildWebhookRequest } = require('../dist/nodes/Pewpros/resources/webhook');
const { toDateTime } = require('../dist/nodes/Pewpros/helpers');

/** A ParamGetter over a plain object, mimicking getNodeParameter. */
function params(values) {
  return (name, fallback) => {
    if (name in values) return values[name];
    if (fallback !== undefined) return fallback;
    throw new Error(`missing parameter ${name}`);
  };
}

// ---------------------------------------------------------------- appointment

test('appointment getAll reduces dates to YYYY-MM-DD', () => {
  const spec = buildAppointmentRequest(
    params({
      appointmentFilters: { from: '2026-11-10T00:00:00', to: '2026-11-17', instructor_id: '' },
    }),
    'getAll',
  );
  assert.equal(spec.method, 'GET');
  assert.equal(spec.path, '/api/v1/admin/appointments');
  assert.deepEqual(spec.qs, { from: '2026-11-10', to: '2026-11-17' });
});

test('appointment create sends integer ids and a repeat rule', () => {
  const spec = buildAppointmentRequest(
    params({
      customerUserId: '12',
      bookingTypeId: '3',
      instructorId: '7',
      startsAt: '2026-11-10T15:00:00Z',
      appointmentCreateFields: { notes: 'hi', notify_customer: false },
      appointmentRepeat: { repeat_weeks: 2, ends_after: 4 },
    }),
    'create',
  );
  assert.equal(spec.method, 'POST');
  assert.equal(spec.path, '/api/v1/admin/appointments');
  assert.deepEqual(spec.body, {
    customer_user_id: 12,
    booking_type_id: 3,
    instructor_id: 7,
    starts_at: '2026-11-10T15:00:00Z',
    notes: 'hi',
    notify_customer: false,
    repeat: { repeat_weeks: 2, ends_after: 4 },
  });
});

test('appointment create without a repeat rule sends no repeat key', () => {
  const spec = buildAppointmentRequest(
    params({
      customerUserId: '1',
      bookingTypeId: '2',
      instructorId: '3',
      startsAt: '2026-11-10T15:00:00Z',
      appointmentCreateFields: {},
      appointmentRepeat: {},
    }),
    'create',
  );
  assert.equal('repeat' in spec.body, false);
});

test('appointment repeat prefers ends_on over ends_after', () => {
  const spec = buildAppointmentRequest(
    params({
      customerUserId: '1',
      bookingTypeId: '2',
      instructorId: '3',
      startsAt: '2026-11-10T15:00:00Z',
      appointmentCreateFields: {},
      appointmentRepeat: { repeat_weeks: 1, ends_after: 4, ends_on: '2026-12-31T00:00:00' },
    }),
    'create',
  );
  assert.deepEqual(spec.body.repeat, { repeat_weeks: 1, ends_on: '2026-12-31' });
});

test('appointment update splits guest emails into an array', () => {
  const spec = buildAppointmentRequest(
    params({
      appointmentId: '44',
      appointmentUpdateFields: { guest_emails: 'a@x.com, b@x.com', scope: 'following' },
    }),
    'update',
  );
  assert.equal(spec.method, 'PATCH');
  assert.equal(spec.path, '/api/v1/admin/appointments/44');
  assert.deepEqual(spec.body, { guest_emails: ['a@x.com', 'b@x.com'], scope: 'following' });
});

test('appointment update with an empty guest emails field clears the list', () => {
  const spec = buildAppointmentRequest(
    params({ appointmentId: '44', appointmentUpdateFields: { guest_emails: '' } }),
    'update',
  );
  assert.deepEqual(spec.body, { guest_emails: [] });
  const untouched = buildAppointmentRequest(
    params({ appointmentId: '44', appointmentUpdateFields: { notes: 'x' } }),
    'update',
  );
  assert.equal('guest_emails' in untouched.body, false);
});

test('appointment cancel keeps an explicit notify_customer false', () => {
  const spec = buildAppointmentRequest(
    params({ appointmentId: '44', appointmentCancelFields: { notify_customer: false } }),
    'cancel',
  );
  assert.deepEqual(spec, {
    method: 'POST',
    path: '/api/v1/admin/appointments/44/cancel',
    body: { notify_customer: false },
  });
});

test('appointment service lines', () => {
  const add = buildAppointmentRequest(
    params({
      appointmentId: '44',
      bookingTypeId: '5',
      instructorId: '7',
      offsetMinutes: 30,
      serviceLineOverrideReason: '',
    }),
    'addServiceLine',
  );
  assert.deepEqual(add.body, { booking_type_id: 5, instructor_id: 7, offset_minutes: 30 });
  const remove = buildAppointmentRequest(
    params({ appointmentId: '44', serviceLineId: '9' }),
    'removeServiceLine',
  );
  assert.deepEqual(remove, {
    method: 'DELETE',
    path: '/api/v1/admin/appointments/44/service-lines/9',
  });
});

test('appointment id must be numeric so it cannot rewrite the path', () => {
  assert.throws(
    () => buildAppointmentRequest(params({ appointmentId: '1/../../contacts' }), 'get'),
    /Appointment ID must be a positive whole number/,
  );
});

// ---------------------------------------------------------------------- range

test('every range operation sends location_id', () => {
  const base = {
    locationId: '2',
    reservationId: '10',
    participantId: '20',
    laneId: '4',
    startsAt: '2026-11-10T15:00:00Z',
    boardDate: '',
    rescheduleDate: '2026-11-11',
    extendMinutes: 30,
    shooterCount: 2,
    participantUpdates: {},
    checkInOptions: {},
    bookerType: 'guest',
    guestName: 'Pat',
    guestPhone: '+15555550100',
    reservationCreateFields: {},
    participants: {},
  };
  const ops = [
    'getBoard',
    'getAll',
    'getRateOptions',
    'get',
    'getRescheduleSlots',
    'create',
    'reschedule',
    'extend',
    'transfer',
    'updateParticipants',
    'checkIn',
    'cancel',
    'noShow',
    'complete',
    'checkInParticipant',
    'sendWaiverLink',
  ];
  for (const op of ops) {
    const spec = buildRangeReservationRequest(params(base), op);
    const carrier = spec.method === 'GET' ? spec.qs : spec.body;
    assert.equal(carrier.location_id, 2, `${op} must send location_id`);
    assert.ok(spec.path.startsWith('/api/v1/admin/range/'), op);
  }
});

test('range create builds the booker, participants and integer ids', () => {
  const spec = buildRangeReservationRequest(
    params({
      locationId: '2',
      laneId: '4',
      startsAt: '2026-11-10T15:00:00Z',
      bookerType: 'user',
      bookerUserId: '99',
      reservationCreateFields: { rate_type_id: '6', shooter_count: 3, source: 'phone' },
      participants: {
        participant: [
          { first_name: 'Sam', last_name: 'Lee', email: '', user_id: '' },
          { first_name: 'Ana', contact_id: '55', junk: 'dropped' },
        ],
      },
    }),
    'create',
  );
  assert.equal(spec.path, '/api/v1/admin/range/reservations');
  assert.deepEqual(spec.body, {
    location_id: 2,
    lane_id: 4,
    starts_at: '2026-11-10T15:00:00Z',
    user_id: 99,
    rate_type_id: 6,
    shooter_count: 3,
    source: 'phone',
    participants: [
      { first_name: 'Sam', last_name: 'Lee' },
      { first_name: 'Ana', contact_id: 55 },
    ],
  });
});

test('range guest booking sends the required guest phone', () => {
  const spec = buildRangeReservationRequest(
    params({
      locationId: '2',
      laneId: '4',
      startsAt: '2026-11-10T15:00:00Z',
      bookerType: 'guest',
      guestName: 'Pat',
      guestPhone: '+15555550100',
      reservationCreateFields: { guest_phone: 'ignored for a guest', guest_email: 'p@x.com' },
      participants: {},
    }),
    'create',
  );
  assert.equal(spec.body.guest_name, 'Pat');
  assert.equal(spec.body.guest_phone, '+15555550100');
  assert.equal(spec.body.guest_email, 'p@x.com');
  assert.equal('participants' in spec.body, false);
});

test('range update participants keeps ids and sends the full list', () => {
  const spec = buildRangeReservationRequest(
    params({
      locationId: '2',
      reservationId: '10',
      shooterCount: 2,
      participantUpdates: { participant: [{ id: '31', first_name: 'Sam' }, { first_name: 'New' }] },
    }),
    'updateParticipants',
  );
  assert.equal(spec.method, 'PUT');
  assert.equal(spec.path, '/api/v1/admin/range/reservations/10/participants');
  assert.deepEqual(spec.body, {
    location_id: 2,
    shooter_count: 2,
    participants: [{ id: 31, first_name: 'Sam' }, { first_name: 'New' }],
  });
});

test('range extend and transfer send integers', () => {
  const extend = buildRangeReservationRequest(
    params({ locationId: '2', reservationId: '10', extendMinutes: 45 }),
    'extend',
  );
  assert.deepEqual(extend.body, { location_id: 2, minutes: 45 });
  const transfer = buildRangeReservationRequest(
    params({ locationId: '2', reservationId: '10', laneId: '7' }),
    'transfer',
  );
  assert.equal(transfer.path, '/api/v1/admin/range/reservations/10/transfer');
  assert.deepEqual(transfer.body, { location_id: 2, lane_id: 7 });
});

test('range get many flattens the board into reservations', () => {
  const spec = buildRangeReservationRequest(
    params({ locationId: '2', boardDate: '2026-11-10T00:00:00' }),
    'getAll',
  );
  assert.deepEqual(spec.qs, { location_id: 2, date: '2026-11-10' });
  const items = spec.toItems({
    data: {
      lanes: [
        {
          id: 1,
          number: 1,
          name: 'Lane 1',
          reservations: [{ id: 100, lane_id: 1, lane_number: 1 }],
        },
        { id: 2, number: 2, name: 'VIP', reservations: [{ id: 101 }, { id: 102 }] },
        { id: 3, number: 3, name: 'Lane 3', reservations: [] },
      ],
    },
  });
  assert.deepEqual(
    items.map((r) => [r.id, r.lane_id, r.lane_number, r.lane_name]),
    [
      [100, 1, 1, 'Lane 1'],
      [101, 2, 2, 'VIP'],
      [102, 2, 2, 'VIP'],
    ],
  );
  assert.deepEqual(flattenBoard({}), []);
});

test('range board without a date omits it (server uses today)', () => {
  const spec = buildRangeReservationRequest(params({ locationId: '2', boardDate: '' }), 'getBoard');
  assert.deepEqual(spec.qs, { location_id: 2 });
  assert.equal(spec.toItems, undefined);
});

test('range requires a numeric location id', () => {
  assert.throws(
    () => buildRangeReservationRequest(params({ locationId: 'main' }), 'getBoard'),
    /Location ID must be a positive whole number/,
  );
});

// --------------------------------------------------------------- registration

test('registration get many passes filters and normalises updated_since', () => {
  const spec = buildRegistrationRequest(
    params({
      registrationFilters: {
        status: 'confirmed',
        updated_since: '2026-11-01T00:00:00Z',
        per_page: 50,
      },
    }),
    'getAll',
  );
  assert.deepEqual(spec, {
    method: 'GET',
    path: '/api/v1/admin/registrations',
    qs: { status: 'confirmed', updated_since: '2026-11-01T00:00:00Z', per_page: 50 },
  });
  assert.equal(
    buildRegistrationRequest(params({ registrationId: '8' }), 'get').path,
    '/api/v1/admin/registrations/8',
  );
});

// ------------------------------------------------------------ membership level

test('membership level add course sends a real boolean false', () => {
  const spec = buildMembershipLevelRequest(
    params({ membershipLevelId: '3', levelCourseId: '9', autoEnroll: false }),
    'addCourse',
  );
  assert.deepEqual(spec, {
    method: 'POST',
    path: '/api/v1/admin/membership-levels/3/courses',
    body: { course_id: 9, auto_enroll: false },
  });
  assert.deepEqual(
    buildMembershipLevelRequest(
      params({ membershipLevelId: '3', levelCourseId: '9' }),
      'removeCourse',
    ),
    { method: 'DELETE', path: '/api/v1/admin/membership-levels/3/courses/9' },
  );
});

// ------------------------------------------------------- membership subscription

test('set amount sends a JSON integer and rejects fractions', () => {
  const spec = buildMembershipSubscriptionRequest(
    params({ subscriptionMembershipId: '5', amountCents: 4999, amountNote: '' }),
    'setAmount',
  );
  assert.deepEqual(spec, {
    method: 'POST',
    path: '/api/v1/admin/memberships/5/subscription/amount',
    body: { amount_cents: 4999 },
  });
  assert.equal(typeof spec.body.amount_cents, 'number');
  assert.throws(
    () =>
      buildMembershipSubscriptionRequest(
        params({ subscriptionMembershipId: '5', amountCents: 49.99, amountNote: '' }),
        'setAmount',
      ),
    /whole number/,
  );
  assert.throws(
    () =>
      buildMembershipSubscriptionRequest(
        params({ subscriptionMembershipId: '5', amountCents: 0, amountNote: '' }),
        'setAmount',
      ),
    /whole number/,
  );
});

test('cancel on a date requires and formats the date', () => {
  const spec = buildMembershipSubscriptionRequest(
    params({
      subscriptionMembershipId: '5',
      cancelMode: 'date',
      cancelOn: '2026-12-01T00:00:00',
      cancelOptions: { reason: 'cost' },
    }),
    'cancelSubscription',
  );
  assert.deepEqual(spec.body, { mode: 'date', reason: 'cost', on: '2026-12-01' });
  const now = buildMembershipSubscriptionRequest(
    params({ subscriptionMembershipId: '5', cancelMode: 'now', cancelOptions: {} }),
    'cancelSubscription',
  );
  assert.deepEqual(now.body, { mode: 'now' });
});

test('undo cancel and clear amount use DELETE', () => {
  const get = params({ subscriptionMembershipId: '5' });
  assert.deepEqual(buildMembershipSubscriptionRequest(get, 'undoCancel'), {
    method: 'DELETE',
    path: '/api/v1/admin/memberships/5/subscription/cancel',
  });
  assert.deepEqual(buildMembershipSubscriptionRequest(get, 'clearAmount'), {
    method: 'DELETE',
    path: '/api/v1/admin/memberships/5/subscription/amount',
  });
});

test('update card only accepts a Stripe PaymentMethod id', () => {
  const spec = buildMembershipSubscriptionRequest(
    params({ subscriptionMembershipId: '5', paymentMethodId: 'pm_1AbC' }),
    'updateCard',
  );
  assert.deepEqual(spec.body, { payment_method_id: 'pm_1AbC' });
  assert.throws(
    () =>
      buildMembershipSubscriptionRequest(
        params({ subscriptionMembershipId: '5', paymentMethodId: '4242424242424242' }),
        'updateCard',
      ),
    /Stripe PaymentMethod ID/,
  );
});

test('hold, timeline and note paths', () => {
  const hold = buildMembershipSubscriptionRequest(
    params({ subscriptionMembershipId: '5', holdOptions: { resume_on: '2027-01-01T00:00:00' } }),
    'hold',
  );
  assert.deepEqual(hold.body, { resume_on: '2027-01-01' });
  assert.equal(
    buildMembershipSubscriptionRequest(params({ subscriptionMembershipId: '5' }), 'getTimeline')
      .path,
    '/api/v1/admin/memberships/5/timeline',
  );
  assert.deepEqual(
    buildMembershipSubscriptionRequest(
      params({ subscriptionMembershipId: '5', noteText: 'hi' }),
      'addNote',
    ),
    { method: 'POST', path: '/api/v1/admin/memberships/5/notes', body: { text: 'hi' } },
  );
});

// ---------------------------------------------------------- check-in / webhook

test('check-in verify routes', () => {
  assert.deepEqual(buildCheckInRequest(params({ qrPayload: 'jwt' }), 'verifyQr'), {
    method: 'POST',
    path: '/api/v1/admin/check-in/verify',
    body: { qr_payload: 'jwt' },
  });
  assert.equal(
    buildCheckInRequest(params({ qrPayload: 'jwt' }), 'verifyMembership').path,
    '/api/v1/admin/check-in/membership-verify',
  );
});

test('webhook test and deliveries', () => {
  assert.deepEqual(buildWebhookRequest(params({ webhookId: '3', testTopic: '' }), 'sendTest'), {
    method: 'POST',
    path: '/api/v1/webhooks/3/test',
    body: {},
  });
  assert.deepEqual(
    buildWebhookRequest(params({ webhookId: '3', deliveryFilters: { page: 2 } }), 'getDeliveries'),
    { method: 'GET', path: '/api/v1/webhooks/3/deliveries', qs: { page: 2 } },
  );
});

// -------------------------------------------------------------------- helpers

test('toDateTime keeps offsets and converts naive values to UTC', () => {
  assert.equal(toDateTime('2026-11-10T15:00:00Z'), '2026-11-10T15:00:00Z');
  assert.equal(toDateTime('2026-11-10T15:00:00-05:00'), '2026-11-10T15:00:00-05:00');
  assert.equal(toDateTime('2026-11-10T15:00:00'), new Date('2026-11-10T15:00:00').toISOString());
  assert.equal(toDateTime(''), '');
  assert.throws(() => toDateTime('tomorrow'), /not a date-time/);
});
