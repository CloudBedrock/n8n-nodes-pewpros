# n8n-nodes-pewpros

This is an n8n community node. It lets you use the [Pewpros](https://pewpros.com)
CRM, events, and learning platform in your n8n workflows.

Pewpros is a multi-tenant platform for contacts, tags, lists, events, courses,
certifications, and conversations. This node talks to the Pewpros REST API.

[n8n](https://n8n.io) is a [fair-code licensed](https://docs.n8n.io/reference/license/)
workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Operations](#operations)
[Compatibility](#compatibility)
[Resources](#resources)

## Installation

Follow the
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation.

In your n8n instance, go to **Settings > Community Nodes**, select **Install**,
and enter `n8n-nodes-pewpros`.

## Credentials

You authenticate with a **Pewpros API token** (Bearer token) belonging to a
Pewpros user. Most write operations require the user to have an admin role
(`owner`, `instructor`, `staff`, or `super_admin`).

Create a **Pewpros API** credential with:

- **API Token** — the user's Bearer API token.
- **Base URL** — the base URL of your Pewpros instance, with no trailing slash.
  - Production example: `https://app.pewpros.com`
  - Development example: `https://dev.pewpros.com`
  - Tenants on custom domains use their own domain.

The credential is verified against `GET /api/v1/auth/me`.

## Operations

| Resource | Operations |
| --- | --- |
| **Contact** | Get Many, Get, Create, Update, Delete, Create or Update, Add Tags, Remove Tags, Add to List, Remove from List |
| **Tag** | Get Many, Create, Update, Delete |
| **List** | Get Many, Create, Update, Delete |
| **Event** | Get Many, Get, Get Registrations, Register Attendee |
| **Course** | Get Many, Get, Enroll |
| **Certification** | Get Many, Get |
| **Conversation** | Get Many, Get, Send Message |

### Not yet supported

- **Appointments** — no REST API in the Pewpros app yet (managed in the UI only).
- **Certification issuing** — issued by a background job, no REST endpoint yet.

These will be added once the platform exposes REST endpoints for them.

## Compatibility

- Requires n8n with `n8nNodesApiVersion` 1 (`n8n-workflow ^1.82.0`).
- Node.js `>=20.15`.

## Development

```bash
npm install
npm run build      # compile TypeScript + copy icons to dist/
npm run lint       # n8n community node lint rules
npm run dev        # tsc --watch
```

To test locally, link the built package into your n8n custom nodes folder and
run an n8n instance pointed at your Pewpros dev host.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Pewpros](https://pewpros.com)

## License

[MIT](LICENSE)
