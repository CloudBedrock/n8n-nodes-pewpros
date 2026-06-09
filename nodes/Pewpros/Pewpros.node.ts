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

export class Pewpros implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pewpros',
    name: 'pewpros',
    icon: 'file:pewpros.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Work with Pewpros contacts, tags, lists, events, courses, and conversations',
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
          { name: 'Conversation', value: 'conversation' },
          { name: 'Course', value: 'course' },
          { name: 'Event', value: 'event' },
          { name: 'List', value: 'list' },
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
          {
            name: 'Add Tags',
            value: 'addTags',
            action: 'Add tags to a contact',
          },
          {
            name: 'Add to List',
            value: 'addToList',
            action: 'Add a contact to lists',
          },
          {
            name: 'Create',
            value: 'create',
            action: 'Create a contact',
          },
          {
            name: 'Create or Update',
            value: 'upsert',
            action: 'Create or update a contact',
          },
          {
            name: 'Delete',
            value: 'delete',
            action: 'Delete a contact',
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get a contact',
          },
          {
            name: 'Get Many',
            value: 'getAll',
            action: 'Get many contacts',
          },
          {
            name: 'Remove From List',
            value: 'removeFromList',
            action: 'Remove a contact from lists',
          },
          {
            name: 'Remove Tags',
            value: 'removeTags',
            action: 'Remove tags from a contact',
          },
          {
            name: 'Update',
            value: 'update',
            action: 'Update a contact',
          },
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
            operation: ['get', 'update', 'delete', 'addTags', 'removeTags', 'addToList', 'removeFromList'],
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
        displayOptions: {
          show: { resource: ['contact'], operation: ['create', 'upsert'] },
        },
        description: 'Email address of the contact (used as the upsert key)',
      },
      {
        displayName: 'Tag IDs',
        name: 'tagIds',
        type: 'string',
        required: true,
        default: '',
        placeholder: '1,2,3',
        displayOptions: {
          show: { resource: ['contact'], operation: ['addTags', 'removeTags'] },
        },
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
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['contact'], operation: ['getAll'] } },
        options: [
          { displayName: 'Contact Type', name: 'contact_type', type: 'string', default: '' },
          { displayName: 'Page', name: 'page', type: 'number', default: 1 },
          { displayName: 'Per Page', name: 'per_page', type: 'number', default: 25 },
          { displayName: 'Search', name: 'search', type: 'string', default: '' },
          { displayName: 'Status', name: 'status', type: 'string', default: '' },
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
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
          { displayName: 'Description', name: 'description', type: 'string', default: '' },
          { displayName: 'Color', name: 'color', type: 'color', default: '' },
          { displayName: 'Emoji', name: 'emoji', type: 'string', default: '' },
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
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
          { displayName: 'Description', name: 'description', type: 'string', default: '' },
          {
            displayName: 'Public',
            name: 'is_public',
            type: 'boolean',
            default: false,
            description: 'Whether the list is public',
          },
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
        displayOptions: { show: { resource: ['course'], operation: ['get', 'enroll'] } },
        description: 'The slug of the course',
      },

      // ----------------------------------------------------------------- Certification
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['certification'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get a certification' },
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
        displayOptions: { show: { resource: ['certification'], operation: ['get'] } },
        description: 'The ID of the certification',
      },

      // ----------------------------------------------------------------- Conversation
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['conversation'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get a conversation' },
          { name: 'Get Many', value: 'getAll', action: 'Get many conversations' },
          { name: 'Send Message', value: 'sendMessage', action: 'Send a message in a conversation' },
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
          show: { resource: ['conversation'], operation: ['get', 'sendMessage'] },
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
        displayOptions: { show: { resource: ['conversation'], operation: ['sendMessage'] } },
        description: 'The message body to send',
      },
      {
        displayName: 'Filters',
        name: 'conversationFilters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['conversation'], operation: ['getAll'] } },
        options: [
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
            qs = this.getNodeParameter('filters', i, {}) as IDataObject;
          } else if (operation === 'get') {
            path = `/api/v1/contacts/${this.getNodeParameter('contactId', i)}`;
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
          }
        } else if (resource === 'tag') {
          if (operation === 'getAll') {
            path = '/api/v1/tags';
          } else if (operation === 'create') {
            method = 'POST';
            path = '/api/v1/tags';
            body = {
              title: this.getNodeParameter('title', i),
              ...(this.getNodeParameter('updateFields', i, {}) as IDataObject),
            };
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/tags/${this.getNodeParameter('tagId', i)}`;
            body = this.getNodeParameter('updateFields', i, {}) as IDataObject;
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
              ...(this.getNodeParameter('listFields', i, {}) as IDataObject),
            };
          } else if (operation === 'update') {
            method = 'PUT';
            path = `/api/v1/lists/${this.getNodeParameter('listId', i)}`;
            body = this.getNodeParameter('listFields', i, {}) as IDataObject;
          } else if (operation === 'delete') {
            method = 'DELETE';
            path = `/api/v1/lists/${this.getNodeParameter('listId', i)}`;
          }
        } else if (resource === 'event') {
          if (operation === 'getAll') {
            path = '/api/v1/events';
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
              ...(this.getNodeParameter('registerFields', i, {}) as IDataObject),
            };
          }
        } else if (resource === 'course') {
          if (operation === 'getAll') {
            path = '/api/v1/courses';
          } else if (operation === 'get') {
            path = `/api/v1/courses/${this.getNodeParameter('courseSlug', i)}`;
          } else if (operation === 'enroll') {
            method = 'POST';
            path = `/api/v1/courses/${this.getNodeParameter('courseSlug', i)}/enroll`;
          }
        } else if (resource === 'certification') {
          if (operation === 'getAll') {
            path = '/api/v1/certifications';
          } else if (operation === 'get') {
            path = `/api/v1/certifications/${this.getNodeParameter('certificationId', i)}`;
          }
        } else if (resource === 'conversation') {
          if (operation === 'getAll') {
            path = '/api/v1/conversations';
            qs = this.getNodeParameter('conversationFilters', i, {}) as IDataObject;
          } else if (operation === 'get') {
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}`;
          } else if (operation === 'sendMessage') {
            method = 'POST';
            path = `/api/v1/conversations/${this.getNodeParameter('conversationId', i)}/messages`;
            body = { message: this.getNodeParameter('message', i) };
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
