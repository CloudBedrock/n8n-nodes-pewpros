import {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestMethods,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
  NodeApiError,
  NodeConnectionTypes,
} from 'n8n-workflow';

import { PewprosHttp } from '../../utils/PewprosHttp';

/** Split a comma-separated id string into an array of numbers/strings. */
function toIdArray(raw: string): Array<number | string> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** Split a comma/space separated string into a trimmed list of strings. */
function toStringList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Map of camelCase additional-field names to the API's snake_case keys. */
const CONTACT_FIELD_MAP: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  phone: 'phone',
  company: 'company',
  source: 'source',
  status: 'status',
  contactType: 'contact_type',
  timezone: 'timezone',
  city: 'city',
  state: 'state',
  postalCode: 'postal_code',
  country: 'country',
  addressLine1: 'address_line_1',
  addressLine2: 'address_line_2',
  dateOfBirth: 'date_of_birth',
  avatarUrl: 'avatar_url',
};

function buildContactBody(email: string | undefined, additional: IDataObject): IDataObject {
  const body: IDataObject = {};
  if (email) {
    body.email = email;
  }
  for (const [camel, snake] of Object.entries(CONTACT_FIELD_MAP)) {
    if (additional[camel] !== undefined && additional[camel] !== '') {
      body[snake] = additional[camel];
    }
  }
  if (additional.metadata) {
    try {
      body.metadata =
        typeof additional.metadata === 'string'
          ? JSON.parse(additional.metadata as string)
          : additional.metadata;
    } catch {
      body.metadata = additional.metadata;
    }
  }
  return body;
}

/** Drop empty-string values from a collection so they are not sent. */
function compact(input: IDataObject): IDataObject {
  const out: IDataObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

export class Pewpros implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pewpros',
    name: 'pewpros',
    icon: 'file:pewpros.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      'Work with Pewpros contacts, notes, tags, lists, conversations, events, courses, certifications, groups, and memberships',
    defaults: {
      name: 'Pewpros',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'pewprosApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Certification', value: 'certification' },
          { name: 'Contact', value: 'contact' },
          { name: 'Contact Note', value: 'contactNote' },
          { name: 'Conversation', value: 'conversation' },
          { name: 'Course', value: 'course' },
          { name: 'Event', value: 'event' },
          { name: 'Group', value: 'group' },
          { name: 'List', value: 'list' },
          { name: 'Membership', value: 'membership' },
          { name: 'Tag', value: 'tag' },
        ],
        default: 'contact',
      },

      // ----------------------------------------------------------------- Contact
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['contact'] } },
        options: [
          { name: 'Add Tags', value: 'addTags', action: 'Add tags to a contact' },
          { name: 'Add to List', value: 'addToList', action: 'Add a contact to lists' },
          { name: 'Bulk Add Tags', value: 'bulkAddTags', action: 'Add tags to many contacts' },
          { name: 'Create', value: 'create', action: 'Create a contact' },
          { name: 'Create or Update', value: 'upsert', action: 'Create or update a contact' },
          { name: 'Delete', value: 'delete', action: 'Delete a contact' },
          { name: 'Get', value: 'get', action: 'Get a contact' },
          { name: 'Get Activities', value: 'getActivities', action: 'Get activities for a contact' },
          { name: 'Get Many', value: 'getAll', action: 'Get many contacts' },
          { name: 'Remove From List', value: 'removeFromList', action: 'Remove a contact from lists' },
          { name: 'Remove Tags', value: 'removeTags', action: 'Remove tags from a contact' },
          { name: 'Update', value: 'update', action: 'Update a contact' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Contact ID',
        name: 'contactId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['contact'],
            operation: [
              'get',
              'update',
              'delete',
              'addTags',
              'removeTags',
              'addToList',
              'removeFromList',
              'getActivities',
            ],
          },
        },
        description: 'The ID of the contact',
      },
      {
        displayName: 'Email',
        name: 'email',
        type: 'string',
        placeholder: 'name@email.com',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['contact'], operation: ['create', 'upsert'] } },
        description: 'Email address of the contact (used as the upsert key)',
      },
      {
        displayName: 'Tag IDs',
        name: 'tagIds',
        type: 'string',
        required: true,
        default: '',
        placeholder: '1,2,3',
        displayOptions: { show: { resource: ['contact'], operation: ['addTags', 'removeTags'] } },
        description: 'Comma-separated list of tag IDs',
      },
      {
        displayName: 'List IDs',
        name: 'listIds',
        type: 'string',
        required: true,
        default: '',
        placeholder: '1,2,3',
        displayOptions: {
          show: { resource: ['contact'], operation: ['addToList', 'removeFromList'] },
        },
        description: 'Comma-separated list of list IDs',
      },
      {
        displayName: 'Contact IDs',
        name: 'bulkContactIds',
        type: 'string',
        required: true,
        default: '',
        placeholder: '1,2,3',
        displayOptions: { show: { resource: ['contact'], operation: ['bulkAddTags'] } },
        description: 'Comma-separated list of contact IDs to tag',
      },
      {
        displayName: 'Tag IDs',
        name: 'bulkTagIds',
        type: 'string',
        required: true,
        default: '',
        placeholder: '1,2,3',
        displayOptions: { show: { resource: ['contact'], operation: ['bulkAddTags'] } },
        description: 'Comma-separated list of tag IDs to apply',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
        options: [
          { displayName: 'Contact Type', name: 'contact_type', type: 'string', default: '' },
          { displayName: 'List IDs', name: 'list_ids', type: 'string', default: '', placeholder: '1,2,3' },
          { displayName: 'Page', name: 'page', type: 'number', default: 1 },
          { displayName: 'Per Page', name: 'per_page', type: 'number', default: 25 },
          { displayName: 'Search', name: 'search', type: 'string', default: '' },
          { displayName: 'Status', name: 'status', type: 'string', default: '' },
          { displayName: 'Tag IDs', name: 'tag_ids', type: 'string', default: '', placeholder: '1,2,3' },
          {
            displayName: 'Updated Since',
            name: 'updated_since',
            type: 'dateTime',
            default: '',
            description: 'Only return contacts updated at or after this time (ISO 8601)',
          },
        ],
      },
      {
        displayName: 'Filters',
        name: 'activityFilters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['contact'], operation: ['getActivities'] } },
        options: [
          { displayName: 'Activity Type', name: 'activity_type', type: 'string', default: '' },
          { displayName: 'Page', name: 'page', type: 'number', default: 1 },
          { displayName: 'Per Page', name: 'per_page', type: 'number', default: 25 },
        ],
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: {
          show: { resource: ['contact'], operation: ['create', 'update', 'upsert'] },
        },
        options: [
          { displayName: 'Address Line 1', name: 'addressLine1', type: 'string', default: '' },
          { displayName: 'Address Line 2', name: 'addressLine2', type: 'string', default: '' },
          { displayName: 'Avatar URL', name: 'avatarUrl', type: 'string', default: '' },
          { displayName: 'City', name: 'city', type: 'string', default: '' },
          { displayName: 'Company', name: 'company', type: 'string', default: '' },
          { displayName: 'Contact Type', name: 'contactType', type: 'string', default: '' },
          { displayName: 'Country', name: 'country', type: 'string', default: '' },
          { displayName: 'Date of Birth', name: 'dateOfBirth', type: 'string', default: '' },
          { displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
          { displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
          {
            displayName: 'Metadata (JSON)',
            name: 'metadata',
            type: 'json',
            default: '',
            description: 'Arbitrary metadata object as JSON',
          },
          { displayName: 'Phone', name: 'phone', type: 'string', default: '' },
          { displayName: 'Postal Code', name: 'postalCode', type: 'string', default: '' },
          { displayName: 'Source', name: 'source', type: 'string', default: '' },
          { displayName: 'State', name: 'state', type: 'string', default: '' },
          { displayName: 'Status', name: 'status', type: 'string', default: '' },
          { displayName: 'Timezone', name: 'timezone', type: 'string', default: '' },
        ],
      },

      // ------------------------------------------------------------- Contact Note
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['contactNote'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a contact note' },
          { name: 'Delete', value: 'delete', action: 'Delete a contact note' },
          { name: 'Get Many', value: 'getAll', action: 'Get many contact notes' },
          { name: 'Update', value: 'update', action: 'Update a contact note' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Contact ID',
        name: 'noteContactId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['contactNote'] } },
        description: 'The ID of the contact the note belongs to',
      },
      {
        displayName: 'Note ID',
        name: 'noteId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['contactNote'], operation: ['update', 'delete'] } },
        description: 'The ID of the note',
      },
      {
        displayName: 'Fields',
        name: 'noteFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['contactNote'], operation: ['create', 'update'] } },
        options: [
          { displayName: 'Description', name: 'description', type: 'string', typeOptions: { rows: 3 }, default: '' },
          { displayName: 'Parent Note ID', name: 'parent_id', type: 'string', default: '' },
          {
            displayName: 'Private',
            name: 'is_private',
            type: 'boolean',
            default: false,
            description: 'Whether the note is private',
          },
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
          {
            displayName: 'Type',
            name: 'type',
            type: 'options',
            default: 'note',
            options: [
              { name: 'Call', value: 'call' },
              { name: 'Email', value: 'email' },
              { name: 'Meeting', value: 'meeting' },
              { name: 'Note', value: 'note' },
              { name: 'SMS', value: 'sms' },
            ],
          },
        ],
      },

      // ----------------------------------------------------------------- Tag
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['tag'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a tag' },
          { name: 'Delete', value: 'delete', action: 'Delete a tag' },
          { name: 'Get Many', value: 'getAll', action: 'Get many tags' },
          { name: 'Update', value: 'update', action: 'Update a tag' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Tag ID',
        name: 'tagId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['tag'], operation: ['update', 'delete'] } },
        description: 'The ID of the tag',
      },
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['tag'], operation: ['create'] } },
        description: 'Title of the tag',
      },
      {
        displayName: 'Update Fields',
        name: 'updateFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['tag'], operation: ['create', 'update'] } },
        options: [
          { displayName: 'Color', name: 'color', type: 'color', default: '' },
          { displayName: 'Description', name: 'description', type: 'string', default: '' },
          { displayName: 'Emoji', name: 'emoji', type: 'string', default: '' },
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
        ],
      },

      // ----------------------------------------------------------------- List
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['list'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a list' },
          { name: 'Delete', value: 'delete', action: 'Delete a list' },
          { name: 'Get Many', value: 'getAll', action: 'Get many lists' },
          { name: 'Update', value: 'update', action: 'Update a list' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'List ID',
        name: 'listId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['list'], operation: ['update', 'delete'] } },
        description: 'The ID of the list',
      },
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['list'], operation: ['create'] } },
        description: 'Title of the list',
      },
      {
        displayName: 'Update Fields',
        name: 'listFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['list'], operation: ['create', 'update'] } },
        options: [
          { displayName: 'Description', name: 'description', type: 'string', default: '' },
          {
            displayName: 'Public',
            name: 'is_public',
            type: 'boolean',
            default: false,
            description: 'Whether the list is public',
          },
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
        ],
      },

      // ----------------------------------------------------------------- Event
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['event'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get an event' },
          { name: 'Get Many', value: 'getAll', action: 'Get many events' },
          {
            name: 'Get Registrations',
            value: 'getRegistrations',
            action: 'Get registrations for an event',
          },
          {
            name: 'Get Upcoming Sessions',
            value: 'getUpcomingSessions',
            action: 'Get upcoming event sessions',
          },
          {
            name: 'Register Attendee',
            value: 'registerAttendee',
            action: 'Register an attendee for an event',
          },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Event Slug',
        name: 'eventSlug',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['event'], operation: ['get'] } },
        description: 'The slug of the event',
      },
      {
        displayName: 'Event ID',
        name: 'eventId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: { resource: ['event'], operation: ['getRegistrations', 'registerAttendee'] },
        },
        description: 'The numeric ID of the event',
      },
      {
        displayName: 'Email',
        name: 'attendeeEmail',
        type: 'string',
        placeholder: 'name@email.com',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['event'], operation: ['registerAttendee'] } },
        description: 'Email of the attendee to register',
      },
      {
        displayName: 'Ticket Type ID',
        name: 'ticketTypeId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['event'], operation: ['registerAttendee'] } },
        description: 'The ticket type to register the attendee against',
      },
      {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        default: 'comp',
        displayOptions: { show: { resource: ['event'], operation: ['registerAttendee'] } },
        options: [
          { name: 'Comp (Free)', value: 'comp' },
          { name: 'Checkout Link', value: 'checkout_link' },
        ],
        description: 'Whether to comp the attendee or send a checkout link',
      },
      {
        displayName: 'Additional Fields',
        name: 'registerFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['event'], operation: ['registerAttendee'] } },
        options: [
          {
            displayName: 'Delivery',
            name: 'delivery',
            type: 'options',
            default: 'email',
            options: [
              { name: 'Both', value: 'both' },
              { name: 'Email', value: 'email' },
              { name: 'SMS', value: 'sms' },
            ],
          },
          { displayName: 'Event Instance ID', name: 'event_instance_id', type: 'string', default: '' },
          { displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
          { displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
          { displayName: 'Phone', name: 'phone', type: 'string', default: '' },
        ],
      },
      {
        displayName: 'Search',
        name: 'registrationSearch',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['event'], operation: ['getRegistrations'] } },
        description: 'Optional search filter for registrations',
      },

      // ----------------------------------------------------------------- Course
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['course'] } },
        options: [
          { name: 'Enroll', value: 'enroll', action: 'Enroll in a course' },
          { name: 'Get', value: 'get', action: 'Get a course' },
          { name: 'Get Enrollments', value: 'getEnrollments', action: 'Get the current user enrollments' },
          { name: 'Get Lessons', value: 'getLessons', action: 'Get lessons for a course' },
          { name: 'Get Many', value: 'getAll', action: 'Get many courses' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Course Slug',
        name: 'courseSlug',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: { resource: ['course'], operation: ['get', 'enroll', 'getLessons'] },
        },
        description: 'The slug of the course',
      },

      // ----------------------------------------------------------- Certification
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['certification'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get a certification' },
          {
            name: 'Get Download URL',
            value: 'getDownload',
            action: 'Get a certification download URL',
          },
          { name: 'Get Many', value: 'getAll', action: 'Get many certifications' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Certification ID',
        name: 'certificationId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: { resource: ['certification'], operation: ['get', 'getDownload'] },
        },
        description: 'The ID of the certification',
      },

      // ----------------------------------------------------------- Conversation
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['conversation'] } },
        options: [
          { name: 'Close', value: 'close', action: 'Close a conversation' },
          { name: 'Create', value: 'create', action: 'Create a conversation' },
          { name: 'Get', value: 'get', action: 'Get a conversation' },
          { name: 'Get Many', value: 'getAll', action: 'Get many conversations' },
          { name: 'Get Messages', value: 'getMessages', action: 'Get messages in a conversation' },
          { name: 'Reopen', value: 'reopen', action: 'Reopen a conversation' },
          {
            name: 'Send',
            value: 'send',
            action: 'Send a message to a contact or phone number',
          },
          {
            name: 'Send Message',
            value: 'sendMessage',
            action: 'Send a message in an existing conversation',
          },
          { name: 'Update', value: 'update', action: 'Update a conversation' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Conversation ID',
        name: 'conversationId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['conversation'],
            operation: ['get', 'sendMessage', 'getMessages', 'update', 'close', 'reopen'],
          },
        },
        description: 'The ID of the conversation',
      },
      {
        displayName: 'Message',
        name: 'message',
        type: 'string',
        required: true,
        default: '',
        typeOptions: { rows: 3 },
        displayOptions: {
          show: { resource: ['conversation'], operation: ['sendMessage', 'send'] },
        },
        description: 'The message body to send',
      },
      {
        displayName: 'Channel',
        name: 'channel',
        type: 'options',
        default: 'sms',
        displayOptions: { show: { resource: ['conversation'], operation: ['create', 'send'] } },
        options: [
          { name: 'Email', value: 'email' },
          { name: 'SMS', value: 'sms' },
          { name: 'Voice', value: 'voice' },
          { name: 'Web', value: 'web' },
        ],
        description: 'The channel to use for the conversation',
      },
      {
        displayName: 'Target By',
        name: 'targetBy',
        type: 'options',
        default: 'contact_id',
        displayOptions: { show: { resource: ['conversation'], operation: ['create', 'send'] } },
        options: [
          { name: 'Contact ID', value: 'contact_id' },
          { name: 'Phone Number', value: 'phone' },
        ],
        description: 'Whether to target an existing contact or a raw phone number',
      },
      {
        displayName: 'Contact ID',
        name: 'conversationContactId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['conversation'],
            operation: ['create', 'send'],
            targetBy: ['contact_id'],
          },
        },
        description: 'The ID of the contact to message',
      },
      {
        displayName: 'Phone Number',
        name: 'conversationPhone',
        type: 'string',
        required: true,
        default: '',
        placeholder: '+15551234567',
        displayOptions: {
          show: {
            resource: ['conversation'],
            operation: ['create', 'send'],
            targetBy: ['phone'],
          },
        },
        description: 'The phone number to message (E.164 format)',
      },
      {
        displayName: 'Update Fields',
        name: 'conversationUpdateFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['conversation'], operation: ['update'] } },
        options: [
          { displayName: 'Assigned To', name: 'assigned_to', type: 'string', default: '' },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            default: 'open',
            options: [
              { name: 'Archived', value: 'archived' },
              { name: 'Closed', value: 'closed' },
              { name: 'Open', value: 'open' },
            ],
          },
        ],
      },
      {
        displayName: 'Filters',
        name: 'messageFilters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['conversation'], operation: ['getMessages'] } },
        options: [
          { displayName: 'After ID', name: 'after_id', type: 'string', default: '' },
          { displayName: 'Before ID', name: 'before_id', type: 'string', default: '' },
          {
            displayName: 'Limit',
            name: 'limit',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 50,
            description: 'Max number of results to return',
          },
        ],
      },
      {
        displayName: 'Filters',
        name: 'conversationFilters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['conversation'], operation: ['getAll'] } },
        options: [
          { displayName: 'Assigned To', name: 'assigned_to', type: 'string', default: '' },
          { displayName: 'Channel', name: 'channel', type: 'string', default: '' },
          { displayName: 'Contact ID', name: 'contact_id', type: 'string', default: '' },
          {
            displayName: 'Limit',
            name: 'limit',
            type: 'number',
            typeOptions: { minValue: 1 },
            default: 50,
            description: 'Max number of results to return',
          },
          { displayName: 'Offset', name: 'offset', type: 'number', default: 0 },
          { displayName: 'Search', name: 'search', type: 'string', default: '' },
          { displayName: 'Status', name: 'status', type: 'string', default: '' },
        ],
      },

      // ----------------------------------------------------------------- Group
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['group'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a group' },
          { name: 'Delete', value: 'delete', action: 'Delete a group' },
          { name: 'Get', value: 'get', action: 'Get a group' },
          { name: 'Get Many', value: 'getAll', action: 'Get many groups' },
          { name: 'Get Members', value: 'getMembers', action: 'Get members of a group' },
          { name: 'Invite', value: 'invite', action: 'Invite people to a group' },
          { name: 'Update', value: 'update', action: 'Update a group' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Group ID',
        name: 'groupId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['group'],
            operation: ['get', 'update', 'delete', 'getMembers', 'invite'],
          },
        },
        description: 'The ID of the group',
      },
      {
        displayName: 'Browse Public Groups',
        name: 'groupBrowse',
        type: 'boolean',
        default: false,
        displayOptions: { show: { resource: ['group'], operation: ['getAll'] } },
        description: 'Whether to list publicly visible groups instead of only your own',
      },
      {
        displayName: 'Name',
        name: 'groupName',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['group'], operation: ['create'] } },
        description: 'Name of the group',
      },
      {
        displayName: 'Slug',
        name: 'groupSlug',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['group'], operation: ['create'] } },
        description: 'URL slug of the group',
      },
      {
        displayName: 'Emails',
        name: 'inviteEmails',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'a@example.com, b@example.com',
        displayOptions: { show: { resource: ['group'], operation: ['invite'] } },
        description: 'Comma or space separated list of email addresses to invite',
      },
      {
        displayName: 'Fields',
        name: 'groupFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['group'], operation: ['create', 'update'] } },
        options: [
          {
            displayName: 'Billing Interval',
            name: 'billing_interval',
            type: 'string',
            default: '',
          },
          { displayName: 'Description', name: 'description', type: 'string', default: '' },
          { displayName: 'Membership Level ID', name: 'membership_level_id', type: 'string', default: '' },
          { displayName: 'Name', name: 'name', type: 'string', default: '' },
          {
            displayName: 'Price (Cents)',
            name: 'price_cents',
            type: 'number',
            default: 0,
            description: 'Price in integer cents',
          },
          { displayName: 'Pricing Model', name: 'pricing_model', type: 'string', default: '' },
          { displayName: 'Slug', name: 'slug', type: 'string', default: '' },
          { displayName: 'Total Seats', name: 'total_seats', type: 'number', default: 0 },
          { displayName: 'Visibility', name: 'visibility', type: 'string', default: '' },
        ],
      },

      // ------------------------------------------------------------- Membership
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['membership'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get a membership' },
          { name: 'Get Current', value: 'getCurrent', action: 'Get the current user membership' },
          { name: 'Get Many', value: 'getAll', action: 'Get many memberships' },
        ],
        default: 'getCurrent',
      },
      {
        displayName: 'Membership ID',
        name: 'membershipId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: ['membership'], operation: ['get'] } },
        description: 'The ID of the membership',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('pewprosApi');
    const http = new PewprosHttp({
      baseUrl: credentials.baseUrl as string,
      apiToken: credentials.apiToken as string,
    });

    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
      try {
        let method: IHttpRequestMethods = 'GET';
        let path = '';
        let body: IDataObject | undefined;
        let qs: IDataObject | undefined;

        if (resource === 'contact') {
          if (operation === 'getAll') {
            path = '/api/v1/contacts';
            qs = compact(this.getNodeParameter('filters', i, {}) as IDataObject);
          } else if (operation === 'get') {
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}`;
          } else if (operation === 'getActivities') {
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}/activities`;
            qs = compact(this.getNodeParameter('activityFilters', i, {}) as IDataObject);
          } else if (operation === 'create' || operation === 'upsert') {
            method = 'POST';
            path = '/api/v1/contacts';
            body = buildContactBody(
              this.getNodeParameter('email', i) as string,
              this.getNodeParameter('additionalFields', i, {}) as IDataObject,
            );
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}`;
            body = buildContactBody(
              undefined,
              this.getNodeParameter('additionalFields', i, {}) as IDataObject,
            );
          } else if (operation === 'delete') {
            method = 'DELETE';
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}`;
          } else if (operation === 'addTags' || operation === 'removeTags') {
            method = operation === 'addTags' ? 'POST' : 'DELETE';
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}/tags`;
            body = { tag_ids: toIdArray(this.getNodeParameter('tagIds', i) as string) };
          } else if (operation === 'addToList' || operation === 'removeFromList') {
            method = operation === 'addToList' ? 'POST' : 'DELETE';
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}/lists`;
            body = { list_ids: toIdArray(this.getNodeParameter('listIds', i) as string) };
          } else if (operation === 'bulkAddTags') {
            method = 'POST';
            path = '/api/v1/contacts/bulk/tags';
            body = {
              contact_ids: toIdArray(this.getNodeParameter('bulkContactIds', i) as string),
              tag_ids: toIdArray(this.getNodeParameter('bulkTagIds', i) as string),
            };
          }
        } else if (resource === 'contactNote') {
          const noteContactId = this.getNodeParameter('noteContactId', i);
          if (operation === 'getAll') {
            path = `/api/v1/contacts/${noteContactId}/notes`;
          } else if (operation === 'create') {
            method = 'POST';
            path = `/api/v1/contacts/${noteContactId}/notes`;
            body = compact(this.getNodeParameter('noteFields', i, {}) as IDataObject);
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/contacts/${noteContactId}/notes/${this.getNodeParameter('noteId', i)}`;
            body = compact(this.getNodeParameter('noteFields', i, {}) as IDataObject);
          } else if (operation === 'delete') {
            method = 'DELETE';
            path = `/api/v1/contacts/${noteContactId}/notes/${this.getNodeParameter('noteId', i)}`;
          }
        } else if (resource === 'tag') {
          if (operation === 'getAll') {
            path = '/api/v1/tags';
          } else if (operation === 'create') {
            method = 'POST';
            path = '/api/v1/tags';
            body = {
              title: this.getNodeParameter('title', i),
              ...compact(this.getNodeParameter('updateFields', i, {}) as IDataObject),
            };
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/tags/${this.getNodeParameter('tagId', i)}`;
            body = compact(this.getNodeParameter('updateFields', i, {}) as IDataObject);
          } else if (operation === 'delete') {
            method = 'DELETE';
            path = `/api/v1/tags/${this.getNodeParameter('tagId', i)}`;
          }
        } else if (resource === 'list') {
          if (operation === 'getAll') {
            path = '/api/v1/lists';
          } else if (operation === 'create') {
            method = 'POST';
            path = '/api/v1/lists';
            body = {
              title: this.getNodeParameter('title', i),
              ...compact(this.getNodeParameter('listFields', i, {}) as IDataObject),
            };
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/lists/${this.getNodeParameter('listId', i)}`;
            body = compact(this.getNodeParameter('listFields', i, {}) as IDataObject);
          } else if (operation === 'delete') {
            method = 'DELETE';
            path = `/api/v1/lists/${this.getNodeParameter('listId', i)}`;
          }
        } else if (resource === 'event') {
          if (operation === 'getAll') {
            path = '/api/v1/events';
          } else if (operation === 'getUpcomingSessions') {
            path = '/api/v1/events/upcoming-sessions';
          } else if (operation === 'get') {
            path = `/api/v1/events/${this.getNodeParameter('eventSlug', i)}`;
          } else if (operation === 'getRegistrations') {
            path = `/api/v1/admin/events/${this.getNodeParameter('eventId', i)}/attendees`;
            const search = this.getNodeParameter('registrationSearch', i, '') as string;
            if (search) {
              qs = { search };
            }
          } else if (operation === 'registerAttendee') {
            method = 'POST';
            path = '/api/v1/admin/registrations/invite';
            body = {
              email: this.getNodeParameter('attendeeEmail', i),
              event_id: this.getNodeParameter('eventId', i),
              ticket_type_id: this.getNodeParameter('ticketTypeId', i),
              mode: this.getNodeParameter('mode', i),
              ...compact(this.getNodeParameter('registerFields', i, {}) as IDataObject),
            };
          }
        } else if (resource === 'course') {
          if (operation === 'getAll') {
            path = '/api/v1/courses';
          } else if (operation === 'getEnrollments') {
            path = '/api/v1/courses/enrollments';
          } else if (operation === 'get') {
            path = `/api/v1/courses/${this.getNodeParameter('courseSlug', i)}`;
          } else if (operation === 'getLessons') {
            path = `/api/v1/courses/${this.getNodeParameter('courseSlug', i)}/lessons`;
          } else if (operation === 'enroll') {
            method = 'POST';
            path = `/api/v1/courses/${this.getNodeParameter('courseSlug', i)}/enroll`;
          }
        } else if (resource === 'certification') {
          if (operation === 'getAll') {
            path = '/api/v1/certifications';
          } else if (operation === 'get') {
            path = `/api/v1/certifications/${this.getNodeParameter('certificationId', i)}`;
          } else if (operation === 'getDownload') {
            path = `/api/v1/certifications/${this.getNodeParameter('certificationId', i)}/download`;
          }
        } else if (resource === 'conversation') {
          if (operation === 'getAll') {
            path = '/api/v1/conversations';
            qs = compact(this.getNodeParameter('conversationFilters', i, {}) as IDataObject);
          } else if (operation === 'get') {
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}`;
          } else if (operation === 'getMessages') {
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}/messages`;
            qs = compact(this.getNodeParameter('messageFilters', i, {}) as IDataObject);
          } else if (operation === 'create') {
            method = 'POST';
            path = '/api/v1/conversations';
            const targetBy = this.getNodeParameter('targetBy', i) as string;
            body = {
              channel: this.getNodeParameter('channel', i),
              [targetBy]:
                targetBy === 'contact_id'
                  ? this.getNodeParameter('conversationContactId', i)
                  : this.getNodeParameter('conversationPhone', i),
            };
          } else if (operation === 'sendMessage') {
            method = 'POST';
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}/messages`;
            body = { message: this.getNodeParameter('message', i) };
          } else if (operation === 'send') {
            method = 'POST';
            path = '/api/v1/conversations/send';
            const targetBy = this.getNodeParameter('targetBy', i) as string;
            body = {
              message: this.getNodeParameter('message', i),
              channel: this.getNodeParameter('channel', i),
              [targetBy]:
                targetBy === 'contact_id'
                  ? this.getNodeParameter('conversationContactId', i)
                  : this.getNodeParameter('conversationPhone', i),
            };
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}`;
            body = compact(this.getNodeParameter('conversationUpdateFields', i, {}) as IDataObject);
          } else if (operation === 'close' || operation === 'reopen') {
            method = 'POST';
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}/${operation}`;
          }
        } else if (resource === 'group') {
          if (operation === 'getAll') {
            path = '/api/v1/groups';
            if (this.getNodeParameter('groupBrowse', i, false) as boolean) {
              qs = { browse: 'true' };
            }
          } else if (operation === 'get') {
            path = `/api/v1/groups/${this.getNodeParameter('groupId', i)}`;
          } else if (operation === 'getMembers') {
            path = `/api/v1/groups/${this.getNodeParameter('groupId', i)}/members`;
          } else if (operation === 'create') {
            method = 'POST';
            path = '/api/v1/groups';
            body = {
              group: {
                name: this.getNodeParameter('groupName', i),
                slug: this.getNodeParameter('groupSlug', i),
                ...compact(this.getNodeParameter('groupFields', i, {}) as IDataObject),
              },
            };
          } else if (operation === 'update') {
            method = 'PATCH';
            path = `/api/v1/groups/${this.getNodeParameter('groupId', i)}`;
            body = { group: compact(this.getNodeParameter('groupFields', i, {}) as IDataObject) };
          } else if (operation === 'delete') {
            method = 'DELETE';
            path = `/api/v1/groups/${this.getNodeParameter('groupId', i)}`;
          } else if (operation === 'invite') {
            method = 'POST';
            path = `/api/v1/groups/${this.getNodeParameter('groupId', i)}/invitations`;
            body = {
              invitation_type: 'email',
              emails: toStringList(this.getNodeParameter('inviteEmails', i) as string),
            };
          }
        } else if (resource === 'membership') {
          if (operation === 'getCurrent') {
            path = '/api/v1/membership';
          } else if (operation === 'getAll') {
            path = '/api/v1/memberships';
          } else if (operation === 'get') {
            path = `/api/v1/memberships/${this.getNodeParameter('membershipId', i)}`;
          }
        }

        const responseData = await http.request(method, path, { body, qs });

        if (Array.isArray(responseData)) {
          for (const entry of responseData) {
            returnData.push({ json: entry as IDataObject, pairedItem: { item: i } });
          }
        } else {
          returnData.push({ json: responseData as IDataObject, pairedItem: { item: i } });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: error instanceof Error ? error.message : String(error) },
            pairedItem: { item: i },
          });
          continue;
        }
        throw new NodeApiError(this.getNode(), error as JsonObject);
      }
    }

    return [returnData];
  }
}
