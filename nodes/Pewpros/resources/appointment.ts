import { IDataObject, INodeProperties } from 'n8n-workflow';

import {
  ParamGetter,
  RequestSpec,
  compact,
  pathId,
  str,
  toDate,
  toDateTime,
  toInts,
  toStringList,
} from '../helpers';

// Admin appointments API (pewpros #2729). Needs the "calendar" capability;
// another instructor's appointments also need "calendar.view_all", and an
// override reason needs "calendar.override_availability".
const BASE = '/api/v1/admin/appointments';

const show = (operation: string[]) => ({ show: { resource: ['appointment'], operation } });

const ID_OPS = [
  'get',
  'update',
  'move',
  'cancel',
  'confirm',
  'reject',
  'reconfirm',
  'addServiceLine',
  'removeServiceLine',
];

const notifyFields: INodeProperties[] = [
  {
    displayName: 'Notify Customer',
    name: 'notify_customer',
    type: 'boolean',
    default: true,
    description: 'Whether to email the customer about the change',
  },
  {
    displayName: 'Notify Staff',
    name: 'notify_staff',
    type: 'boolean',
    default: true,
    description: 'Whether to notify the instructor and staff about the change',
  },
  {
    displayName: 'Override Reason',
    name: 'override_reason',
    type: 'string',
    default: '',
    description:
      'Book outside the instructor availability. At least 3 characters; needs the "Override availability" permission.',
  },
];

const scopeField: INodeProperties = {
  displayName: 'Apply To',
  name: 'scope',
  type: 'options',
  default: '',
  options: [
    { name: 'This Appointment Only', value: '' },
    { name: 'This and Following in the Series', value: 'following' },
  ],
};

export const appointmentProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['appointment'] } },
    options: [
      {
        name: 'Add Service Line',
        value: 'addServiceLine',
        action: 'Add a service line to an appointment',
      },
      { name: 'Cancel', value: 'cancel', action: 'Cancel an appointment' },
      {
        name: 'Confirm',
        value: 'confirm',
        action: 'Confirm a requested appointment',
        description: 'Accept a requested appointment. This captures the payment held at booking.',
      },
      { name: 'Create', value: 'create', action: 'Create an appointment' },
      { name: 'Get', value: 'get', action: 'Get an appointment' },
      {
        name: 'Get Available Slots',
        value: 'getSlots',
        action: 'Get available appointment slots',
      },
      { name: 'Get Many', value: 'getAll', action: 'Get many appointments' },
      { name: 'Move', value: 'move', action: 'Move an appointment to a new time' },
      { name: 'Reconfirm', value: 'reconfirm', action: 'Reconfirm an appointment' },
      { name: 'Reject', value: 'reject', action: 'Reject a requested appointment' },
      {
        name: 'Remove Service Line',
        value: 'removeServiceLine',
        action: 'Remove a service line from an appointment',
      },
      { name: 'Update', value: 'update', action: 'Update an appointment' },
    ],
    default: 'getAll',
  },
  {
    displayName: 'Appointment ID',
    name: 'appointmentId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(ID_OPS),
  },
  {
    displayName: 'Filters',
    name: 'appointmentFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: show(['getAll']),
    options: [
      {
        displayName: 'From',
        name: 'from',
        type: 'dateTime',
        default: '',
        description: 'Only appointments starting on or after this date (UTC)',
      },
      {
        displayName: 'Instructor ID',
        name: 'instructor_id',
        type: 'string',
        default: '',
        description:
          'Only this instructor. Needs the "View all calendars" permission; without it you only get your own.',
      },
      {
        displayName: 'To',
        name: 'to',
        type: 'dateTime',
        default: '',
        description: 'Only appointments starting on or before this date (UTC)',
      },
    ],
  },

  // Slots
  {
    displayName: 'Booking Type ID',
    name: 'bookingTypeId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(['getSlots', 'create', 'addServiceLine']),
  },
  {
    displayName: 'Date',
    name: 'slotDate',
    type: 'dateTime',
    required: true,
    default: '',
    displayOptions: show(['getSlots']),
    description: 'The day to look up, in the instructor time zone',
  },
  {
    displayName: 'Options',
    name: 'slotOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: show(['getSlots']),
    options: [
      {
        displayName: 'Exclude Appointment ID',
        name: 'exclude_appointment_id',
        type: 'string',
        default: '',
        description: 'Treat this appointment as free (use when finding a time to move it to)',
      },
      {
        displayName: 'Instructor ID',
        name: 'instructor_id',
        type: 'string',
        default: '',
        description: 'Defaults to the API token user',
      },
    ],
  },

  // Create
  {
    displayName: 'Customer User ID',
    name: 'customerUserId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(['create']),
    description: 'The user who is booking',
  },
  {
    displayName: 'Instructor ID',
    name: 'instructorId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(['create', 'addServiceLine']),
  },
  {
    displayName: 'Starts At',
    name: 'startsAt',
    type: 'dateTime',
    required: true,
    default: '',
    displayOptions: show(['create', 'move']),
    description: 'Start time (ISO 8601). The end time comes from the booking type duration.',
  },
  {
    displayName: 'Additional Fields',
    name: 'appointmentCreateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show(['create']),
    options: [
      {
        displayName: 'Attendee User ID',
        name: 'attendee_user_id',
        type: 'string',
        default: '',
        description: 'A household member attending instead of the customer',
      },
      {
        displayName: 'Notes',
        name: 'notes',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
      },
      ...notifyFields,
      { displayName: 'Student Phone', name: 'student_phone', type: 'string', default: '' },
    ],
  },
  {
    displayName: 'Repeat',
    name: 'appointmentRepeat',
    type: 'collection',
    placeholder: 'Add Repeat Rule',
    default: {},
    displayOptions: show(['create']),
    description: 'Book a weekly series instead of one appointment',
    options: [
      {
        displayName: 'Ends After (Occurrences)',
        name: 'ends_after',
        type: 'number',
        typeOptions: { minValue: 2, maxValue: 52 },
        default: 4,
        description: 'Total number of appointments. Use this or Ends On.',
      },
      {
        displayName: 'Ends On',
        name: 'ends_on',
        type: 'dateTime',
        default: '',
        description: 'Last date of the series, at most 366 days out. Use this or Ends After.',
      },
      {
        displayName: 'Every N Weeks',
        name: 'repeat_weeks',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 12 },
        default: 1,
      },
    ],
  },

  // Update
  {
    displayName: 'Update Fields',
    name: 'appointmentUpdateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show(['update']),
    options: [
      {
        displayName: 'Guest Emails',
        name: 'guest_emails',
        type: 'string',
        default: '',
        placeholder: 'a@example.com, b@example.com',
        description: 'Comma or space separated. Replaces the current list.',
      },
      {
        displayName: 'Notes',
        name: 'notes',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
      },
      { displayName: 'Student Phone', name: 'student_phone', type: 'string', default: '' },
      scopeField,
    ],
  },

  // Move
  {
    displayName: 'Additional Fields',
    name: 'appointmentMoveFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show(['move']),
    options: [
      {
        displayName: 'Instructor ID',
        name: 'instructor_id',
        type: 'string',
        default: '',
        description: 'Move to another instructor',
      },
      ...notifyFields.map((field) =>
        field.name === 'notify_customer'
          ? {
              ...field,
              description:
                'Whether to email the customer. Defaults to the appointment own setting when not set.',
            }
          : field,
      ),
      scopeField,
    ],
  },

  // Cancel
  {
    displayName: 'Additional Fields',
    name: 'appointmentCancelFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show(['cancel']),
    options: [
      {
        displayName: 'Notify Customer',
        name: 'notify_customer',
        type: 'boolean',
        default: false,
        description: 'Whether to email the customer (the server default is not to)',
      },
      scopeField,
    ],
  },

  // Reject
  {
    displayName: 'Reason',
    name: 'rejectReason',
    type: 'string',
    default: '',
    displayOptions: show(['reject']),
    description: 'Shown to the customer',
  },

  // Service lines
  {
    displayName: 'Offset Minutes',
    name: 'offsetMinutes',
    type: 'number',
    typeOptions: { minValue: 0, maxValue: 120 },
    required: true,
    default: 0,
    displayOptions: show(['addServiceLine']),
    description: 'Minutes after the appointment start that this service begins (0-120)',
  },
  {
    displayName: 'Override Reason',
    name: 'serviceLineOverrideReason',
    type: 'string',
    default: '',
    displayOptions: show(['addServiceLine']),
    description: 'Needs the "Override availability" permission',
  },
  {
    displayName: 'Service Line ID',
    name: 'serviceLineId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(['removeServiceLine']),
  },
];

const INT_KEYS = [
  'instructor_id',
  'attendee_user_id',
  'exclude_appointment_id',
  'customer_user_id',
  'booking_type_id',
];

export function buildAppointmentRequest(get: ParamGetter, operation: string): RequestSpec {
  if (operation === 'getAll') {
    const filters = compact(get('appointmentFilters', {}) as IDataObject);
    return {
      method: 'GET',
      path: BASE,
      qs: compact({
        from: toDate(filters.from),
        to: toDate(filters.to),
        instructor_id: filters.instructor_id,
      }),
    };
  }

  if (operation === 'getSlots') {
    return {
      method: 'GET',
      path: `${BASE}/slots`,
      qs: compact({
        booking_type_id: str(get, 'bookingTypeId'),
        date: toDate(get('slotDate')),
        ...compact(get('slotOptions', {}) as IDataObject),
      }),
    };
  }

  if (operation === 'create') {
    const fields = compact(get('appointmentCreateFields', {}) as IDataObject);
    const body: IDataObject = toInts(
      {
        customer_user_id: str(get, 'customerUserId'),
        booking_type_id: str(get, 'bookingTypeId'),
        instructor_id: str(get, 'instructorId'),
        starts_at: toDateTime(get('startsAt')),
        ...fields,
      },
      INT_KEYS,
    );
    const repeat = compact(get('appointmentRepeat', {}) as IDataObject);
    if (Object.keys(repeat).length > 0) {
      const rule: IDataObject = { repeat_weeks: repeat.repeat_weeks ?? 1 };
      if (repeat.ends_on) {
        rule.ends_on = toDate(repeat.ends_on);
      } else if (repeat.ends_after !== undefined) {
        rule.ends_after = repeat.ends_after;
      } else {
        throw new Error('Pewpros: a repeat rule needs Ends After or Ends On.');
      }
      body.repeat = rule;
    }
    return { method: 'POST', path: BASE, body };
  }

  const id = pathId(get, 'appointmentId', 'Appointment ID');

  switch (operation) {
    case 'get':
      return { method: 'GET', path: `${BASE}/${id}` };
    case 'update': {
      const fields = compact(get('appointmentUpdateFields', {}) as IDataObject);
      if (typeof fields.guest_emails === 'string') {
        fields.guest_emails = toStringList(fields.guest_emails);
      }
      return { method: 'PATCH', path: `${BASE}/${id}`, body: fields };
    }
    case 'move':
      return {
        method: 'POST',
        path: `${BASE}/${id}/move`,
        body: toInts(
          {
            starts_at: toDateTime(get('startsAt')),
            ...compact(get('appointmentMoveFields', {}) as IDataObject),
          },
          INT_KEYS,
        ),
      };
    case 'cancel':
      return {
        method: 'POST',
        path: `${BASE}/${id}/cancel`,
        body: compact(get('appointmentCancelFields', {}) as IDataObject),
      };
    case 'confirm':
    case 'reconfirm':
      return { method: 'POST', path: `${BASE}/${id}/${operation}` };
    case 'reject':
      return {
        method: 'POST',
        path: `${BASE}/${id}/reject`,
        body: compact({ reason: str(get, 'rejectReason') }),
      };
    case 'addServiceLine':
      return {
        method: 'POST',
        path: `${BASE}/${id}/service-lines`,
        body: toInts(
          compact({
            booking_type_id: str(get, 'bookingTypeId'),
            instructor_id: str(get, 'instructorId'),
            offset_minutes: Number(get('offsetMinutes', 0)),
            override_reason: str(get, 'serviceLineOverrideReason'),
          }),
          INT_KEYS,
        ),
      };
    case 'removeServiceLine':
      return {
        method: 'DELETE',
        path: `${BASE}/${id}/service-lines/${pathId(get, 'serviceLineId', 'Service Line ID')}`,
      };
    default:
      throw new Error(`Pewpros: unknown appointment operation "${operation}"`);
  }
}
