import {
  ICredentialDataDecryptedObject,
  ICredentialTestRequest,
  ICredentialType,
  IHttpRequestOptions,
  INodeProperties,
} from 'n8n-workflow';

import { assertSecureRequestTarget } from '../utils/PewprosHttp';

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
      description:
        'Base URL of your Pewpros instance, without a trailing slash. Must be https:// (http is only allowed for localhost). Example dev value: https://dev.pewpros.com.',
    },
  ];

  // Refuses to attach the token to any request that is not https (loopback
  // excepted): the credential test and HTTP Request nodes alike.
  async authenticate(
    credentials: ICredentialDataDecryptedObject,
    requestOptions: IHttpRequestOptions,
  ): Promise<IHttpRequestOptions> {
    assertSecureRequestTarget(requestOptions, credentials.baseUrl as string | undefined);
    return {
      ...requestOptions,
      headers: {
        ...(requestOptions.headers ?? {}),
        Authorization: `Bearer ${credentials.apiToken as string}`,
      },
    };
  }

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/auth/me',
      method: 'GET',
    },
  };
}
