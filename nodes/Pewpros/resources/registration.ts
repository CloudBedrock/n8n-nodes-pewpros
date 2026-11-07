import { IDataObject, INodeProperties } from 'n8n-workflow';

import { ParamGetter, RequestSpec, compact, pathId, toDateTime } from '../helpers';

// Site-wide event registrations (pewpros #994). Needs the
// "classes.registrations" capability.
const BASE = '/api/v1/admin/registrations';

export const registrationProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['registration'] } },
    options: [
      { name: 'Get', value: 'get', action: 'Get a registration' },
      { name: 'Get Many', value: 'getAll', action: 'Get many registrations' },
    ],
    default: 'getAll',
  },
  {
    displayName: 'Registration ID',
    name: 'registrationId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { resource: ['registration'], operation: ['get'] } },
  },
  {
    displayName: 'Filters',
    name: 'registrationFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: ['registration'], operation: ['getAll'] } },
    options: [
      { displayName: 'Event ID', name: 'event_id', type: 'string', default: '' },
      {
        displayName: 'Page',
        name: 'page',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 1,
      },
      {
        displayName: 'Payment Method',
        name: 'payment_method',
        type: 'options',
        default: 'stripe',
        options: [
          { name: 'Authorize.Net', value: 'authorize_net' },
          { name: 'Cash', value: 'cash' },
          { name: 'Check', value: 'check' },
          { name: 'COD', value: 'cod' },
          { name: 'Comp', value: 'comp' },
          { name: 'Fortis', value: 'fortis' },
          { name: 'NMI', value: 'nmi' },
          { name: 'Phone', value: 'phone' },
          { name: 'Register', value: 'register' },
          { name: 'Square', value: 'square' },
          { name: 'Stripe', value: 'stripe' },
          { name: 'Terminal', value: 'terminal' },
          { name: 'Venmo', value: 'venmo' },
          { name: 'Zelle', value: 'zelle' },
        ],
      },
      {
        displayName: 'Per Page',
        name: 'per_page',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 25,
      },
      {
        displayName: 'Search',
        name: 'search',
        type: 'string',
        default: '',
        description: 'Name, email or phone of the attendee',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        default: 'confirmed',
        options: [
          { name: 'Cancelled', value: 'cancelled' },
          { name: 'Checked In', value: 'checked_in' },
          { name: 'Confirmed', value: 'confirmed' },
          { name: 'No Show', value: 'no_show' },
          { name: 'To Reschedule', value: 'to_reschedule' },
          { name: 'Waitlisted', value: 'waitlisted' },
        ],
      },
      {
        displayName: 'Updated Since',
        name: 'updated_since',
        type: 'dateTime',
        default: '',
        description:
          'Only registrations updated at or after this time. Results are then sorted oldest change first.',
      },
    ],
  },
];

export function buildRegistrationRequest(get: ParamGetter, operation: string): RequestSpec {
  if (operation === 'get') {
    return { method: 'GET', path: `${BASE}/${pathId(get, 'registrationId', 'Registration ID')}` };
  }
  const qs = compact(get('registrationFilters', {}) as IDataObject);
  if (qs.updated_since) {
    qs.updated_since = toDateTime(qs.updated_since);
  }
  return { method: 'GET', path: BASE, qs };
}
