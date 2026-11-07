import { IDataObject, INodeProperties } from 'n8n-workflow';

import { ParamGetter, RequestSpec, compact, pathId, str } from '../helpers';

// Webhook subscription management. Needs the "setup.integrations" capability.
const BASE = '/api/v1/webhooks';

export const webhookProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['webhook'] } },
    options: [
      {
        name: 'Get Deliveries',
        value: 'getDeliveries',
        action: 'Get deliveries for a webhook subscription',
      },
      {
        name: 'Send Test',
        value: 'sendTest',
        action: 'Send a test event to a webhook subscription',
      },
    ],
    default: 'getDeliveries',
  },
  {
    displayName: 'Webhook Subscription ID',
    name: 'webhookId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { resource: ['webhook'] } },
  },
  {
    displayName: 'Topic',
    name: 'testTopic',
    type: 'string',
    default: '',
    placeholder: 'contact.created',
    displayOptions: { show: { resource: ['webhook'], operation: ['sendTest'] } },
    description:
      'Event type for the test. Defaults to the first event the subscription listens to.',
  },
  {
    displayName: 'Filters',
    name: 'deliveryFilters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: { show: { resource: ['webhook'], operation: ['getDeliveries'] } },
    options: [
      {
        displayName: 'Page',
        name: 'page',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 1,
      },
      {
        displayName: 'Per Page',
        name: 'per_page',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 25,
      },
    ],
  },
];

export function buildWebhookRequest(get: ParamGetter, operation: string): RequestSpec {
  const id = pathId(get, 'webhookId', 'Webhook Subscription ID');
  if (operation === 'sendTest') {
    return {
      method: 'POST',
      path: `${BASE}/${id}/test`,
      body: compact({ topic: str(get, 'testTopic') }),
    };
  }
  return {
    method: 'GET',
    path: `${BASE}/${id}/deliveries`,
    qs: compact(get('deliveryFilters', {}) as IDataObject),
  };
}
