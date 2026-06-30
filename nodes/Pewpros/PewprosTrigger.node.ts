import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';

import { PewprosHttp } from '../../utils/PewprosHttp';

// The registerable outbound-webhook topics (docs/funnels + Webhooks.topics/0).
const EVENT_TOPICS = [
  'contact.created',
  'contact.updated',
  'registration.created',
  'registration.cancelled',
  'enrollment.created',
  'order.paid',
  'conversation.created',
  'message.received',
  'membership.created',
  'membership.updated',
  'membership.cancelled',
];

interface SubscriptionState {
  webhookId?: number;
  secret?: string;
}

function httpFromCredentials(credentials: IDataObject): PewprosHttp {
  return new PewprosHttp({
    baseUrl: credentials.baseUrl as string,
    apiToken: credentials.apiToken as string,
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('HTTP 404');
}

export class PewprosTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pewpros Trigger',
    name: 'pewprosTrigger',
    icon: 'file:pewpros.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: 'Starts a workflow when a Pewpros event fires (outbound webhook)',
    defaults: {
      name: 'Pewpros Trigger',
    },
    inputs: [],
    outputs: ['main'],
    credentials: [
      {
        name: 'pewprosApi',
        required: true,
      },
    ],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: [],
        description: 'Event topics that should start this workflow',
        options: EVENT_TOPICS.map((topic) => ({ name: topic, value: topic })),
      },
      {
        displayName: 'Verify Signature',
        name: 'verifySignature',
        type: 'boolean',
        default: true,
        description:
          'Whether to reject deliveries whose Pewpros-Signature HMAC does not match the subscription secret. Leave on.',
      },
    ],
  };

  webhookMethods = {
    default: {
      // Treat the subscription as existing only when we hold its id AND the
      // server still has it; otherwise fall through to (re)create.
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const state = this.getWorkflowStaticData('node') as SubscriptionState;
        if (!state.webhookId) {
          return false;
        }

        const http = httpFromCredentials(await this.getCredentials('pewprosApi'));
        try {
          await http.request('GET', `/api/v1/webhooks/${state.webhookId}`);
          return true;
        } catch (error) {
          if (isNotFound(error)) {
            delete state.webhookId;
            delete state.secret;
            return false;
          }
          throw error;
        }
      },

      // Idempotent register: the backend matches by URL + event set, so a
      // re-activated workflow reuses its subscription instead of duplicating.
      async create(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl('default');
        const events = this.getNodeParameter('events', []) as string[];
        const http = httpFromCredentials(await this.getCredentials('pewprosApi'));

        const response = await http.request<{ data: { id: number; secret: string } }>(
          'POST',
          '/api/v1/webhooks/register',
          { body: { url: webhookUrl, events } },
        );

        const state = this.getWorkflowStaticData('node') as SubscriptionState;
        state.webhookId = response.data.id;
        state.secret = response.data.secret;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const state = this.getWorkflowStaticData('node') as SubscriptionState;
        if (!state.webhookId) {
          return true;
        }

        const http = httpFromCredentials(await this.getCredentials('pewprosApi'));
        try {
          await http.request('DELETE', `/api/v1/webhooks/${state.webhookId}`);
        } catch (error) {
          // A subscription deleted out-of-band is fine; anything else propagates.
          if (!isNotFound(error)) {
            throw error;
          }
        }

        delete state.webhookId;
        delete state.secret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const body = this.getBodyData();
    const verify = this.getNodeParameter('verifySignature', true) as boolean;

    if (verify) {
      const state = this.getWorkflowStaticData('node') as SubscriptionState;
      const secret = state.secret;
      const signatureHeader = this.getHeaderData()['pewpros-signature'] as string | undefined;

      // Sign over the EXACT received bytes, not a re-serialised body.
      const rawBody =
        (req as unknown as { rawBody?: Buffer | string }).rawBody?.toString() ??
        JSON.stringify(body);

      if (!secret || !signatureHeader || !verifySignature(secret, signatureHeader, rawBody)) {
        const res = this.getResponseObject();
        res.status(401).json({ error: 'invalid signature' });
        return { noWebhookResponse: true };
      }
    }

    return {
      workflowData: [this.helpers.returnJsonArray(body as IDataObject)],
    };
  }
}

// Pewpros-Signature: t=<unix>,v1=<hex> where v1 = HMAC_SHA256(secret, "<t>.<rawBody>").
function verifySignature(secret: string, header: string, rawBody: string): boolean {
  const match = /t=(\d+),v1=([0-9a-f]+)/.exec(header);
  if (!match) {
    return false;
  }
  const [, timestamp, provided] = match;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
