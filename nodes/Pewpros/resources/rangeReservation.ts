import { IDataObject, INodeProperties } from 'n8n-workflow';

import {
  ParamGetter,
  RequestSpec,
  collectionRows,
  compact,
  pathId,
  str,
  toDate,
  toDateTime,
  toInts,
} from '../helpers';

// Admin range API (RangeController, #1598). Needs the "range" capability, and
// every route needs the location the lanes belong to.
const BASE = '/api/v1/admin/range';

const show = (operation: string[]) => ({
  show: { resource: ['rangeReservation'], operation },
});

const RESERVATION_ID_OPS = [
  'get',
  'getRescheduleSlots',
  'reschedule',
  'extend',
  'transfer',
  'updateParticipants',
  'checkIn',
  'cancel',
  'noShow',
  'complete',
];

const PARTICIPANT_ID_OPS = ['checkInParticipant', 'sendWaiverLink'];

const PARTICIPANT_KEYS = [
  'user_id',
  'contact_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'date_of_birth',
  'relationship',
];

const participantValues: INodeProperties[] = [
  { displayName: 'Contact ID', name: 'contact_id', type: 'string', default: '' },
  {
    displayName: 'Date of Birth',
    name: 'date_of_birth',
    type: 'string',
    default: '',
    placeholder: 'YYYY-MM-DD',
  },
  {
    displayName: 'Email',
    name: 'email',
    type: 'string',
    placeholder: 'name@email.com',
    default: '',
  },
  { displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
  { displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
  { displayName: 'Phone', name: 'phone', type: 'string', default: '' },
  { displayName: 'Relationship', name: 'relationship', type: 'string', default: '' },
  { displayName: 'User ID', name: 'user_id', type: 'string', default: '' },
];

const overrideFields: INodeProperties[] = [
  {
    displayName: 'Lane Block Override Reason',
    name: 'lane_block_override_reason',
    type: 'string',
    default: '',
    description:
      'Override a staff alert that blocks this customer from a lane. Needs the "Waiver override" range permission.',
  },
];

export const rangeReservationProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['rangeReservation'] } },
    options: [
      { name: 'Cancel', value: 'cancel', action: 'Cancel a lane reservation' },
      { name: 'Check In', value: 'checkIn', action: 'Check in a lane reservation' },
      {
        name: 'Check In Participant',
        value: 'checkInParticipant',
        action: 'Check in one shooter on a reservation',
      },
      { name: 'Complete', value: 'complete', action: 'Complete a lane reservation' },
      { name: 'Create', value: 'create', action: 'Create a lane reservation' },
      {
        name: 'Extend',
        value: 'extend',
        action: 'Extend a lane reservation',
      },
      { name: 'Get', value: 'get', action: 'Get a lane reservation' },
      {
        name: 'Get Board',
        value: 'getBoard',
        action: 'Get the lane board for a day',
        description: 'Every lane for the day, with its reservations and closures nested under it',
      },
      {
        name: 'Get Many',
        value: 'getAll',
        action: 'Get many lane reservations for a day',
        description:
          'Reservations on the board for a day, one item each. Only reserved and checked-in reservations appear on the board.',
      },
      { name: 'Get Rate Options', value: 'getRateOptions', action: 'Get range rate options' },
      {
        name: 'Get Reschedule Slots',
        value: 'getRescheduleSlots',
        action: 'Get times a reservation can move to',
      },
      { name: 'Mark No-Show', value: 'noShow', action: 'Mark a lane reservation as a no show' },
      {
        name: 'Move to Lane',
        value: 'transfer',
        action: 'Move a lane reservation to another lane',
      },
      { name: 'Reschedule', value: 'reschedule', action: 'Reschedule a lane reservation' },
      {
        name: 'Send Waiver Link',
        value: 'sendWaiverLink',
        action: 'Send a shooter the waiver link',
      },
      {
        name: 'Update Participants',
        value: 'updateParticipants',
        action: 'Update the shooters on a lane reservation',
      },
    ],
    default: 'getAll',
  },
  {
    displayName: 'Location ID',
    name: 'locationId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { resource: ['rangeReservation'] } },
    description: 'The range location the lanes belong to',
  },
  {
    displayName: 'Reservation ID',
    name: 'reservationId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(RESERVATION_ID_OPS),
  },
  {
    displayName: 'Participant ID',
    name: 'participantId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(PARTICIPANT_ID_OPS),
    description: 'The ID of the shooter (participant) on the reservation',
  },
  {
    displayName: 'Date',
    name: 'boardDate',
    type: 'dateTime',
    default: '',
    displayOptions: show(['getBoard', 'getAll']),
    description: 'The day to show, in the location time zone. Defaults to today (UTC).',
  },
  {
    displayName: 'Date',
    name: 'rescheduleDate',
    type: 'dateTime',
    required: true,
    default: '',
    displayOptions: show(['getRescheduleSlots']),
    description: 'The day to look for free times on',
  },

  // Create
  {
    displayName: 'Lane ID',
    name: 'laneId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(['create', 'transfer']),
  },
  {
    displayName: 'Starts At',
    name: 'startsAt',
    type: 'dateTime',
    required: true,
    default: '',
    displayOptions: show(['create', 'reschedule']),
    description:
      'Start time (ISO 8601). A value without a time zone offset is read in the n8n server time zone.',
  },
  {
    displayName: 'Booker',
    name: 'bookerType',
    type: 'options',
    default: 'guest',
    displayOptions: show(['create']),
    options: [
      { name: 'Existing User', value: 'user' },
      { name: 'Guest', value: 'guest' },
    ],
  },
  {
    displayName: 'User ID',
    name: 'bookerUserId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['rangeReservation'], operation: ['create'], bookerType: ['user'] },
    },
  },
  {
    displayName: 'Guest Name',
    name: 'guestName',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['rangeReservation'], operation: ['create'], bookerType: ['guest'] },
    },
  },
  {
    displayName: 'Guest Phone',
    name: 'guestPhone',
    type: 'string',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['rangeReservation'], operation: ['create'], bookerType: ['guest'] },
    },
  },
  {
    displayName: 'Additional Fields',
    name: 'reservationCreateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show(['create']),
    options: [
      {
        displayName: 'Contact Email',
        name: 'guest_email',
        type: 'string',
        placeholder: 'name@email.com',
        default: '',
        description: 'Email for the booking confirmation',
      },
      {
        displayName: 'Contact Phone',
        name: 'guest_phone',
        type: 'string',
        default: '',
        description:
          'Phone for the booking when the booker is an existing user (a guest uses Guest Phone)',
      },
      {
        displayName: 'Duration (Minutes)',
        name: 'duration_minutes',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 60,
        description: 'Used when Ends At is not set. Defaults to the rate option duration.',
      },
      {
        displayName: 'Ends At',
        name: 'ends_at',
        type: 'dateTime',
        default: '',
      },
      ...overrideFields,
      {
        displayName: 'Notify Customer',
        name: 'notify_customer',
        type: 'boolean',
        default: true,
        description: 'Whether to send the customer a confirmation',
      },
      {
        displayName: 'Notify Staff',
        name: 'notify_staff',
        type: 'boolean',
        default: true,
        description: 'Whether to notify staff of the booking',
      },
      { displayName: 'Rate Type ID', name: 'rate_type_id', type: 'string', default: '' },
      {
        displayName: 'Shooter Count',
        name: 'shooter_count',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 1,
        description:
          'The whole party, booker included. A party bigger than the lane spills onto more lanes.',
      },
      {
        displayName: 'Source',
        name: 'source',
        type: 'options',
        default: 'counter',
        options: [
          { name: 'Counter', value: 'counter' },
          { name: 'Phone', value: 'phone' },
        ],
      },
    ],
  },
  {
    displayName: 'Participants',
    name: 'participants',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    placeholder: 'Add Participant',
    default: {},
    displayOptions: show(['create']),
    description: 'Shooters in the party besides the booker',
    options: [{ displayName: 'Participant', name: 'participant', values: participantValues }],
  },

  // Update participants
  {
    displayName: 'Shooter Count',
    name: 'shooterCount',
    type: 'number',
    typeOptions: { minValue: 1 },
    required: true,
    default: 1,
    displayOptions: show(['updateParticipants']),
    description: 'The whole party, booker included',
  },
  {
    displayName: 'Participants',
    name: 'participantUpdates',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    placeholder: 'Add Participant',
    default: {},
    displayOptions: show(['updateParticipants']),
    description:
      'The full list of shooters. A row with an ID keeps that shooter, a row without one adds a shooter, and shooters left out are removed.',
    options: [
      {
        displayName: 'Participant',
        name: 'participant',
        values: [
          {
            displayName: 'Participant ID',
            name: 'id',
            type: 'string',
            default: '',
            description: 'Set to keep an existing shooter; leave empty to add one',
          },
          ...participantValues,
        ],
      },
    ],
  },

  // Extend
  {
    displayName: 'Minutes',
    name: 'extendMinutes',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 240 },
    required: true,
    default: 30,
    displayOptions: show(['extend']),
    description:
      'Minutes to add (1-240). The response includes any overtime charge as charge_cents.',
  },

  // Check in
  {
    displayName: 'Options',
    name: 'checkInOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: show(['checkIn', 'checkInParticipant']),
    options: [
      ...overrideFields,
      {
        displayName: 'Override Waiver',
        name: 'override',
        type: 'boolean',
        default: false,
        description:
          'Whether to check in without a signed waiver. Needs the "Waiver override" range permission.',
      },
    ],
  },
];

function participantRows(value: unknown, keys: string[]): IDataObject[] {
  return collectionRows(value, 'participant').map((row) => {
    const out: IDataObject = {};
    for (const key of keys) {
      const raw = row[key];
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        out[key] = String(raw).trim();
      }
    }
    return toInts(out, ['id', 'user_id', 'contact_id']);
  });
}

/** Flatten the board into one record per reservation, tagged with its lane. */
export function flattenBoard(response: unknown): IDataObject[] {
  const data = (response as IDataObject | undefined)?.data as IDataObject | undefined;
  const lanes = Array.isArray(data?.lanes) ? (data!.lanes as IDataObject[]) : [];
  const out: IDataObject[] = [];
  for (const lane of lanes) {
    const reservations = Array.isArray(lane.reservations)
      ? (lane.reservations as IDataObject[])
      : [];
    for (const reservation of reservations) {
      out.push({
        ...reservation,
        lane_id: reservation.lane_id ?? lane.id,
        lane_number: reservation.lane_number ?? lane.number,
        lane_name: lane.name,
      });
    }
  }
  return out;
}

export function buildRangeReservationRequest(get: ParamGetter, operation: string): RequestSpec {
  const locationId = Number(pathId(get, 'locationId', 'Location ID'));
  const loc = { location_id: locationId };

  if (operation === 'getBoard' || operation === 'getAll') {
    return {
      method: 'GET',
      path: `${BASE}/board`,
      qs: compact({ ...loc, date: toDate(get('boardDate', '')) }),
      toItems: operation === 'getAll' ? flattenBoard : undefined,
    };
  }
  if (operation === 'getRateOptions') {
    return { method: 'GET', path: `${BASE}/rate-options`, qs: loc };
  }
  if (operation === 'create') {
    const fields = compact(get('reservationCreateFields', {}) as IDataObject);
    if (fields.ends_at) {
      fields.ends_at = toDateTime(fields.ends_at);
    }
    const booker: IDataObject =
      get('bookerType', 'guest') === 'user'
        ? { user_id: Number(pathId(get, 'bookerUserId', 'User ID')) }
        : { guest_name: str(get, 'guestName'), guest_phone: str(get, 'guestPhone') };
    const participants = participantRows(get('participants', {}), PARTICIPANT_KEYS);
    const body: IDataObject = toInts(
      {
        ...loc,
        lane_id: pathId(get, 'laneId', 'Lane ID'),
        starts_at: toDateTime(get('startsAt')),
        ...fields,
        ...booker,
      },
      ['lane_id', 'rate_type_id'],
    );
    if (participants.length > 0) {
      body.participants = participants;
    }
    return { method: 'POST', path: `${BASE}/reservations`, body };
  }

  if (PARTICIPANT_ID_OPS.includes(operation)) {
    const participantId = pathId(get, 'participantId', 'Participant ID');
    if (operation === 'checkInParticipant') {
      return {
        method: 'POST',
        path: `${BASE}/participants/${participantId}/check-in`,
        body: { ...loc, ...compact(get('checkInOptions', {}) as IDataObject) },
      };
    }
    return {
      method: 'POST',
      path: `${BASE}/participants/${participantId}/send-waiver-link`,
      body: loc,
    };
  }

  const id = pathId(get, 'reservationId', 'Reservation ID');
  const path = `${BASE}/reservations/${id}`;

  switch (operation) {
    case 'get':
      return { method: 'GET', path, qs: loc };
    case 'getRescheduleSlots':
      return {
        method: 'GET',
        path: `${path}/reschedule-slots`,
        qs: { ...loc, date: toDate(get('rescheduleDate')) },
      };
    case 'reschedule':
      return {
        method: 'POST',
        path: `${path}/reschedule`,
        body: { ...loc, starts_at: toDateTime(get('startsAt')) },
      };
    case 'extend':
      return {
        method: 'POST',
        path: `${path}/extend`,
        body: { ...loc, minutes: Number(get('extendMinutes', 30)) },
      };
    case 'transfer':
      return {
        method: 'POST',
        path: `${path}/transfer`,
        body: { ...loc, lane_id: Number(pathId(get, 'laneId', 'Lane ID')) },
      };
    case 'updateParticipants':
      return {
        method: 'PUT',
        path: `${path}/participants`,
        body: {
          ...loc,
          shooter_count: Number(get('shooterCount', 1)),
          participants: participantRows(get('participantUpdates', {}), ['id', ...PARTICIPANT_KEYS]),
        },
      };
    case 'checkIn':
      return {
        method: 'POST',
        path: `${path}/check-in`,
        body: { ...loc, ...compact(get('checkInOptions', {}) as IDataObject) },
      };
    case 'cancel':
      return { method: 'POST', path: `${path}/cancel`, body: loc };
    case 'noShow':
      return { method: 'POST', path: `${path}/no-show`, body: loc };
    case 'complete':
      return { method: 'POST', path: `${path}/complete`, body: loc };
    default:
      throw new Error(`Pewpros: unknown range reservation operation "${operation}"`);
  }
}
