import {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class PewprosApi implements ICredentialType {
  name = 'pewprosApi';
  displayName = 'Pewpros API';
  documentationUrl = 'https://github.com/CloudBedrock/n8n-nodes-pewpros';
  properties: INodeProperties[] = [
    {
      displayName: 'API Token',
      name: 'apiToken',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      description:
        'Bearer API token for a Pewpros user. Most write operations require the user to have an admin role (owner, instructor, staff, or super_admin).',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://app.pewpros.com',
      required: true,
      description: 'Base URL of your Pewpros instance, without a trailing slash. Example dev value: https://dev.pewpros.com.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiToken}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/auth/me',
      method: 'GET',
    },
  };
}
