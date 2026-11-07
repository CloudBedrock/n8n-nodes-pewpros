import {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';

import { PewprosHttp } from '../../utils/PewprosHttp';
import { rememberEventId, SeenEventState, verifySignature } from '../../utils/webhookSecurity';

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
  'waiver.signed',
];

interface SubscriptionState extends SeenEventState {
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

  // Every delivery is verified; there is no way to turn this off.
  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const res = this.getResponseObject();
    const body = this.getBodyData();
    const state = this.getWorkflowStaticData('node') as SubscriptionState;

    const reject = (reason: string): IWebhookResponseData => {
      res.status(401).json({ error: reason });
      return { noWebhookResponse: true };
    };

    // Sign over the EXACT received bytes. Never rebuild the body to verify it.
    const rawBody = (req as unknown as { rawBody?: Buffer | string }).rawBody;
    if (rawBody === undefined || rawBody === null) {
      return reject('raw body unavailable');
    }

    const secret = state.secret;
    if (!secret) {
      return reject('no subscription secret');
    }

    const signatureHeader = this.getHeaderData()['pewpros-signature'] as string | undefined;
    if (!signatureHeader) {
      return reject('missing signature');
    }

    const result = verifySignature(secret, signatureHeader, rawBody, Math.floor(Date.now() / 1000));
    if (result !== 'ok') {
      return reject(
        result === 'stale'
          ? 'stale signature'
          : result === 'malformed'
            ? 'malformed signature'
            : 'invalid signature',
      );
    }

    // Pewpros retries failed sends; each event keeps its `evt_...` id. A repeat
    // is acknowledged so the sender stops retrying, but runs nothing.
    const eventId = (body as IDataObject).id;
    if (typeof eventId === 'string' && eventId !== '' && !rememberEventId(state, eventId)) {
      res.status(200).json({ received: true, duplicate: true });
      return { noWebhookResponse: true };
    }

    return {
      workflowData: [this.helpers.returnJsonArray(body as IDataObject)],
    };
  }
}
