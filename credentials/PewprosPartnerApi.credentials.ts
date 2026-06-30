import {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * Secret server-to-server partner credential (`sk_partner_...`) for the
 * facility-management partner API under `/api/v1/partner` (customers,
 * memberships, range, bookings, orders, events). Distinct from the Bearer
 * `Pewpros API` credential used for the CRM/admin surface and webhook triggers.
 */
export class PewprosPartnerApi implements ICredentialType {
  name = 'pewprosPartnerApi';
  displayName = 'Pewpros Partner API';
  documentationUrl = 'https://github.com/CloudBedrock/n8n-nodes-pewpros';
  properties: INodeProperties[] = [
    {
      displayName: 'Partner Key',
      name: 'partnerKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description:
        'Secret partner key (sk_partner_...) generated in Site Settings → Integrations. This is NOT the public funnel key (pk_...).',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://app.pewpros.com',
      required: true,
      description:
        'Base URL of your Pewpros instance, without a trailing slash. Must be https:// (http is only allowed for localhost). Example dev value: https://dev.pewpros.com.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'X-Partner-Key': '={{$credentials.partnerKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/partner/whoami',
      method: 'GET',
    },
  };
}
