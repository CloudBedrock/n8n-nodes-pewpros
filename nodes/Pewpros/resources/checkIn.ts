import { INodeProperties } from 'n8n-workflow';

import { ParamGetter, RequestSpec, str } from '../helpers';

// QR check-in verification. Needs the "classes.check_in" capability. Both
// routes answer 200 with `valid` and `reason`, so an invalid pass is data,
// not an error.
export const checkInProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['checkIn'] } },
    options: [
      {
        name: 'Verify Membership',
        value: 'verifyMembership',
        action: 'Verify a membership pass QR code',
        description: 'Check a membership pass: whether it is valid, and range access',
      },
      {
        name: 'Verify QR Code',
        value: 'verifyQr',
        action: 'Verify an event or membership pass QR code',
      },
    ],
    default: 'verifyQr',
  },
  {
    displayName: 'QR Payload',
    name: 'qrPayload',
    type: 'string',
    typeOptions: { password: true },
    required: true,
    default: '',
    displayOptions: { show: { resource: ['checkIn'] } },
    description: 'The scanned QR code content (a signed pass token)',
  },
];

export function buildCheckInRequest(get: ParamGetter, operation: string): RequestSpec {
  const path =
    operation === 'verifyMembership'
      ? '/api/v1/admin/check-in/membership-verify'
      : '/api/v1/admin/check-in/verify';
  return { method: 'POST', path, body: { qr_payload: str(get, 'qrPayload') } };
}
