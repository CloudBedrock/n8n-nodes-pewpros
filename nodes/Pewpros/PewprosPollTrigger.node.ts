import {
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IPollFunctions,
  NodeConnectionTypes,
} from 'n8n-workflow';

import { PewprosHttp } from '../../utils/PewprosHttp';

// Both endpoints implement the /api/v1/contacts incremental-sync contract:
// `updated_since` is inclusive (updated_at >= since) and cursored responses are
// ordered ascending by (updated_at, id). We advance the cursor to the highest
// updated_at seen and remember the ids AT that timestamp to dedupe the
// inclusive boundary on the next poll.
const EVENT_CONFIG: Record<string, { path: string }> = {
  waiverSignature: { path: '/api/v1/waiver-signatures' },
  affiliateLead: { path: '/api/v1/affiliate-leads' },
};

const PER_PAGE = 100;

interface PollState {
  lastUpdatedAt?: string;
  seenIds?: number[];
}

interface ApiRecord extends IDataObject {
  id: number;
  updated_at: string;
}

interface ListResponse {
  data: ApiRecord[];
  meta?: { total?: number };
}

export class PewprosPollTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pewpros Poll Trigger',
    name: 'pewprosPollTrigger',
    icon: 'file:pewpros.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["event"]}}',
    description:
      'Starts a workflow when new waiver signatures or affiliate leads appear (polls the Pewpros API)',
    defaults: {
      name: 'Pewpros Poll Trigger',
    },
    polling: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'pewprosApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Event',
        name: 'event',
        type: 'options',
        required: true,
        default: 'waiverSignature',
        options: [
          { name: 'New Affiliate Lead', value: 'affiliateLead' },
          { name: 'New Waiver Signature', value: 'waiverSignature' },
        ],
        description: 'Which record type to watch for new or updated entries',
      },
      {
        displayName: 'Filters',
        name: 'signatureFilters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { event: ['waiverSignature'] } },
        options: [
          { displayName: 'Contact ID', name: 'contact_id', type: 'string', default: '' },
          { displayName: 'Course ID', name: 'course_id', type: 'string', default: '' },
          { displayName: 'Event ID', name: 'event_id', type: 'string', default: '' },
          { displayName: 'Waiver ID', name: 'waiver_id', type: 'string', default: '' },
        ],
      },
      {
        displayName: 'Filters',
        name: 'leadFilters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { event: ['affiliateLead'] } },
        options: [
          { displayName: 'Source', name: 'source', type: 'string', default: '' },
          { displayName: 'Status', name: 'status', type: 'string', default: '' },
        ],
      },
    ],
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const credentials = await this.getCredentials('pewprosApi');
    const http = new PewprosHttp({
      baseUrl: credentials.baseUrl as string,
      apiToken: credentials.apiToken as string,
    });

    const event = this.getNodeParameter('event') as string;
    const config = EVENT_CONFIG[event];
    const filterParam = event === 'waiverSignature' ? 'signatureFilters' : 'leadFilters';
    const filters = this.getNodeParameter(filterParam, {}) as IDataObject;
    const baseQs: IDataObject = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        baseQs[key] = value;
      }
    }

    // Manual test run: return the most recent records without moving the cursor.
    if (this.getMode() === 'manual') {
      const response = await http.request<ListResponse>('GET', config.path, {
        qs: { ...baseQs, per_page: 10 },
      });
      if (!response.data.length) {
        return null;
      }
      return [this.helpers.returnJsonArray(response.data as IDataObject[])];
    }

    const state = this.getWorkflowStaticData('node') as PollState;

    // First activation: start the cursor at now rather than replaying history.
    if (!state.lastUpdatedAt) {
      state.lastUpdatedAt = new Date().toISOString();
      state.seenIds = [];
      return null;
    }

    const cursor = state.lastUpdatedAt;
    const cursorTs = Date.parse(cursor);
    const seenIds = new Set(state.seenIds ?? []);
    const records: ApiRecord[] = [];

    let page = 1;
    for (;;) {
      const response = await http.request<ListResponse>('GET', config.path, {
        qs: { ...baseQs, updated_since: cursor, per_page: PER_PAGE, page },
      });
      records.push(...response.data);
      if (response.data.length < PER_PAGE) {
        break;
      }
      page += 1;
    }

    // Timestamps are compared by parsed value, not string equality, because the
    // initial cursor (our own toISOString) and server timestamps can differ in
    // sub-second precision while naming the same instant.
    // Drop boundary records already emitted on a previous poll.
    const fresh = records.filter(
      (record) => !(Date.parse(record.updated_at) === cursorTs && seenIds.has(record.id)),
    );

    // Advance the cursor to the highest updated_at seen (results are ascending,
    // but compare defensively) and remember the ids at that exact timestamp.
    if (records.length > 0) {
      let maxUpdatedAt = cursor;
      let maxTs = cursorTs;
      for (const record of records) {
        const ts = Date.parse(record.updated_at);
        if (ts > maxTs) {
          maxTs = ts;
          maxUpdatedAt = record.updated_at;
        }
      }
      const idsAtMax = records
        .filter((record) => Date.parse(record.updated_at) === maxTs)
        .map((record) => record.id);
      state.lastUpdatedAt = maxUpdatedAt;
      state.seenIds = maxTs === cursorTs ? [...new Set([...seenIds, ...idsAtMax])] : idsAtMax;
    }

    if (!fresh.length) {
      return null;
    }

    return [this.helpers.returnJsonArray(fresh as IDataObject[])];
  }
}
