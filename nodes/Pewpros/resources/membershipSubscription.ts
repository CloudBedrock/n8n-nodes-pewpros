import { IDataObject, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { ParamGetter, RequestSpec, compact, pathId, str, toDate } from '../helpers';

// Staff controls for a membership's subscription. The pipeline needs the
// "memberships" capability; changes also need "memberships.edit", and Update
// Card needs "crm.manage_cards". The id is the membership id, not the
// subscription id.
const BASE = '/api/v1/admin/memberships';

export const SUBSCRIPTION_OPERATIONS = [
  'hold',
  'resume',
  'cancelSubscription',
  'undoCancel',
  'setAmount',
  'clearAmount',
  'updateCard',
  'getTimeline',
  'addNote',
];

/** Operation options merged into the Membership resource's operation list. */
export const subscriptionOperationOptions: INodePropertyOptions[] = [
  { name: 'Add Note', value: 'addNote', action: 'Add a note to a membership timeline' },
  {
    name: 'Cancel Subscription',
    value: 'cancelSubscription',
    action: 'Cancel a membership subscription',
  },
  {
    name: 'Clear Scheduled Amount',
    value: 'clearAmount',
    action: 'Withdraw a scheduled change to the membership amount',
  },
  { name: 'Get Timeline', value: 'getTimeline', action: 'Get a membership timeline' },
  { name: 'Hold', value: 'hold', action: 'Put a membership subscription on hold' },
  { name: 'Resume', value: 'resume', action: 'Resume a held membership subscription' },
  {
    name: 'Set Amount',
    value: 'setAmount',
    action: 'Change the recurring amount of a membership',
    description: 'Change the recurring charge. An increase is scheduled and the member is emailed.',
  },
  {
    name: 'Undo Scheduled Cancel',
    value: 'undoCancel',
    action: 'Withdraw a cancellation scheduled for a date',
  },
  {
    name: 'Update Card',
    value: 'updateCard',
    action: 'Change the card a membership is charged to',
    description: 'Switch to another card the member already has saved (Stripe only)',
  },
];

const show = (operation: string[]) => ({ show: { resource: ['membership'], operation } });

export const membershipSubscriptionProperties: INodeProperties[] = [
  {
    displayName: 'Membership ID',
    name: 'subscriptionMembershipId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show(SUBSCRIPTION_OPERATIONS),
    description: 'The ID of the membership (not the subscription)',
  },

  // Hold
  {
    displayName: 'Options',
    name: 'holdOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: show(['hold']),
    options: [
      { displayName: 'Note', name: 'note', type: 'string', default: '' },
      {
        displayName: 'Resume On',
        name: 'resume_on',
        type: 'dateTime',
        default: '',
        description: 'Date to resume billing (after today). Leave empty for an open-ended hold.',
      },
    ],
  },

  // Cancel
  {
    displayName: 'When',
    name: 'cancelMode',
    type: 'options',
    required: true,
    default: 'period_end',
    displayOptions: show(['cancelSubscription']),
    options: [
      { name: 'At End of Current Period', value: 'period_end' },
      { name: 'Immediately', value: 'now' },
      { name: 'On a Date', value: 'date' },
    ],
  },
  {
    displayName: 'Cancel On',
    name: 'cancelOn',
    type: 'dateTime',
    required: true,
    default: '',
    displayOptions: {
      show: { resource: ['membership'], operation: ['cancelSubscription'], cancelMode: ['date'] },
    },
    description: 'A future date; the membership is cancelled that day',
  },
  {
    displayName: 'Options',
    name: 'cancelOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: show(['cancelSubscription']),
    options: [
      { displayName: 'Note', name: 'note', type: 'string', default: '' },
      {
        displayName: 'Reason',
        name: 'reason',
        type: 'options',
        default: 'staff_cancelled',
        options: [
          { name: 'Cost', value: 'cost' },
          { name: 'Health', value: 'health' },
          { name: 'Moved Away', value: 'moved_away' },
          { name: 'Not Using', value: 'not_using' },
          { name: 'Other', value: 'other' },
          { name: 'Staff Cancelled', value: 'staff_cancelled' },
          { name: 'Unhappy', value: 'unhappy' },
        ],
      },
    ],
  },

  // Amount
  {
    displayName: 'Amount (Cents)',
    name: 'amountCents',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 10000000, numberPrecision: 0 },
    required: true,
    default: 0,
    displayOptions: show(['setAmount']),
    description: 'New recurring amount in whole cents, e.g. 4999 for $49.99',
  },
  {
    displayName: 'Note',
    name: 'amountNote',
    type: 'string',
    default: '',
    displayOptions: show(['setAmount']),
  },

  // Card
  {
    displayName: 'Payment Method ID',
    name: 'paymentMethodId',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'pm_...',
    displayOptions: show(['updateCard']),
    description:
      'The Stripe PaymentMethod ID of a card the member already has saved. No card number is sent.',
  },

  // Note
  {
    displayName: 'Text',
    name: 'noteText',
    type: 'string',
    typeOptions: { rows: 3 },
    required: true,
    default: '',
    displayOptions: show(['addNote']),
    description: 'Up to 2000 characters',
  },
];

export function buildMembershipSubscriptionRequest(
  get: ParamGetter,
  operation: string,
): RequestSpec {
  const id = pathId(get, 'subscriptionMembershipId', 'Membership ID');
  const sub = `${BASE}/${id}/subscription`;

  switch (operation) {
    case 'hold': {
      const options = compact(get('holdOptions', {}) as IDataObject);
      if (options.resume_on) {
        options.resume_on = toDate(options.resume_on);
      }
      return { method: 'POST', path: `${sub}/hold`, body: options };
    }
    case 'resume':
      return { method: 'POST', path: `${sub}/resume` };
    case 'cancelSubscription': {
      const mode = str(get, 'cancelMode');
      const body: IDataObject = { mode, ...compact(get('cancelOptions', {}) as IDataObject) };
      if (mode === 'date') {
        body.on = toDate(get('cancelOn'));
        if (!body.on) {
          throw new Error('Pewpros: Cancel On is required when cancelling on a date.');
        }
      }
      return { method: 'POST', path: `${sub}/cancel`, body };
    }
    case 'undoCancel':
      return { method: 'DELETE', path: `${sub}/cancel` };
    case 'setAmount': {
      const amount = Number(get('amountCents'));
      if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) {
        throw new Error(
          `Pewpros: Amount (Cents) must be a whole number from 1 to 10000000 (got "${get('amountCents')}").`,
        );
      }
      return {
        method: 'POST',
        path: `${sub}/amount`,
        body: compact({ amount_cents: amount, note: str(get, 'amountNote') }),
      };
    }
    case 'clearAmount':
      return { method: 'DELETE', path: `${sub}/amount` };
    case 'updateCard': {
      const paymentMethodId = str(get, 'paymentMethodId');
      if (!/^pm_[A-Za-z0-9]+$/.test(paymentMethodId)) {
        throw new Error(
          'Pewpros: Payment Method ID must be a Stripe PaymentMethod ID (pm_...). Never send card numbers.',
        );
      }
      return { method: 'POST', path: `${sub}/card`, body: { payment_method_id: paymentMethodId } };
    }
    case 'getTimeline':
      return { method: 'GET', path: `${BASE}/${id}/timeline` };
    case 'addNote':
      return { method: 'POST', path: `${BASE}/${id}/notes`, body: { text: str(get, 'noteText') } };
    default:
      throw new Error(`Pewpros: unknown membership operation "${operation}"`);
  }
}
