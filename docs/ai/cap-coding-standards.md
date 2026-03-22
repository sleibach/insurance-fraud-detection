# CAP Coding Standards

Authoritative coding standards for this SAP CAP project. Referenced by both Cursor rules/skills and Claude Code (CLAUDE.md).

## Project Structure

```
insurance-fraud-detection/
├── db/                          # Domain models
│   └── schema.cds               # All entity definitions (namespace fraud)
├── srv/                         # Service layer
│   ├── *.cds                    # Service definitions (one per service)
│   ├── *.js                     # Thin handler files (one per service, same name as .cds)
│   └── code/                    # Implementation logic modules
│       ├── <entity>-on-<action>-logic.js
│       ├── <entity>-before-<event>-logic.js
│       ├── <entity>-after-<event>-logic.js
│       └── utils/               # Shared utilities
├── app/                         # Fiori Elements UIs
│   └── <appname>/
│       ├── annotations.cds      # UI annotations for this app
│       ├── webapp/
│       └── ui5.yaml
└── docs/ai/                     # AI agent reference docs (this folder)
```

### File Naming Conventions

| Location | Pattern | Example |
|----------|---------|---------|
| Service CDS | `<ServiceName>.cds` | `ClaimService.cds` |
| Service handler | `<ServiceName>.js` (same name) | `ClaimService.js` |
| Entity action logic | `<entity>-on-<action>-logic.js` | `claims-on-evaluate-logic.js` |
| Before event logic | `<entity>-before-<event>-logic.js` | `claims-before-create-logic.js` |
| After event logic | `<entity>-after-<event>-logic.js` | `claims-after-read-logic.js` |
| Service-level action | `on-<action>-logic.js` | `on-processClaim-logic.js` |
| Shared utilities | `utils/<name>.js` | `utils/aiClient.js` |

## CDS Modeling

### Entity Definitions

Always use `@sap/cds/common` for managed aspects and standard types:

```cds
using { managed, cuid, sap } from '@sap/cds/common';

namespace fraud;

entity Claims : cuid, managed {
  title           : String(255);
  description     : localized String(5000);
  status          : Association to ClaimStatuses;
  claimAmount     : Decimal(15,2);
  currency        : Currency;
  attachments     : Composition of many Attachments on attachments.claim = $self;
}
```

### Key Patterns

- **Always** use `cuid` for auto-generated UUIDs instead of manual key definitions
- **Always** use `managed` for `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy`
- **Prefer** `Association` for references, `Composition` for owned children
- **Prefer** `localized String` for user-facing text that may need translation
- **Use** code lists for status/type enumerations:

```cds
@cds.autoexpose
entity ClaimStatuses : sap.common.CodeList {
  key code : String(20);
}
```

### Annotations in CDS Models

- Use `@title` and `@description` for metadata -- CAP compiles them to OData annotations automatically
- Use `@assert.range`, `@assert.unique`, `@mandatory` for data validation
- Use `@readonly` for computed/read-only fields
- Keep UI annotations (`@UI.*`) in `app/<appname>/annotations.cds`, not in `db/schema.cds`

```cds
entity Claims : cuid, managed {
  @title: 'Claim Title'
  title         : String(255);

  @title: 'Amount'
  @mandatory
  claimAmount   : Decimal(15,2);

  @readonly
  fraudScore    : Decimal(5,4);
}
```

## Service Definitions

Service CDS files live in `srv/`. They expose projections on domain entities:

```cds
using { fraud as db } from '../db/schema';

@path: '/service/ClaimService'
@requires: 'authenticated-user'
service ClaimService {

  @odata.draft.enabled
  entity Claims as projection on db.Claims;

  @readonly
  entity Predictions as projection on db.Predictions;

  // Bound action on Claims
  action evaluate(claimId : UUID) returns String;
}
```

### Key Patterns

- **Use `projection on`** to expose domain entities -- never redefine them
- **Use `excluding { ... }`** to hide internal fields from the API
- **Use `@odata.draft.enabled`** for entities editable via Fiori Elements
- **Use `@readonly`** for entities that are only read, never written by the user
- **Use `@requires`** for service-level authorization
- **Use `@restrict`** for entity-level fine-grained access control
- **Use `@Capabilities.Deletable: false`** etc. for granular operation restrictions

## Handler Pattern

Handler files in `srv/*.js` are **thin wiring only**. They register event handlers and delegate to logic modules in `srv/code/`.

```javascript
const cds = require('@sap/cds');

class ClaimService extends cds.ApplicationService {
  async init() {
    const { Claims } = cds.entities('ClaimService');

    // Delegate to logic modules -- NO business logic here
    const evaluateLogic = require('./code/claims-on-evaluate-logic');
    const beforeCreateLogic = require('./code/claims-before-create-logic');
    const afterReadLogic = require('./code/claims-after-read-logic');

    this.on('evaluate', Claims, async (req) => evaluateLogic(req));
    this.before('CREATE', Claims, async (req) => beforeCreateLogic(req));
    this.after('READ', Claims, async (results, req) => afterReadLogic(results, req));

    return super.init();
  }
}

module.exports = ClaimService;
```

### Rules

- Handler file must `extend cds.ApplicationService`
- Call `return super.init()` at the end
- **Never** put business logic directly in the handler file
- Keep requires/imports at the top of `init()` or at module level
- One handler file per service, matching the CDS file name

## Implementation Logic

Logic modules in `srv/code/` contain the actual business logic. Each file exports a single async function.

```javascript
const cds = require('@sap/cds');

module.exports = async function (req) {
  const { Claims, Predictions } = cds.entities('ClaimService');
  const { ID } = req.params[0] || req.data;

  const claim = await SELECT.one.from(Claims).where({ ID });
  if (!claim) return req.reject(404, 'Claim not found');

  // ... business logic ...

  await UPDATE(Claims).set({ status_code: 'evaluated' }).where({ ID });
  return result;
};
```

### CQL -- Always Use It

**Never** write raw SQL. Always use CDS Query Language (CQL) via `cds.ql`:

```javascript
const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

// Read
const claims = await SELECT.from(Claims).where({ status_code: 'new' });
const claim = await SELECT.one.from(Claims).where({ ID });

// Read with expand (associations)
const claimWithAttachments = await SELECT.from(Claims)
  .where({ ID })
  .columns(c => {
    c('*'),
    c.attachments(a => a('*'))
  });

// Create
await INSERT.into(Claims).entries({ title: 'New Claim', claimAmount: 1500 });

// Update
await UPDATE(Claims).set({ fraudScore: 0.85 }).where({ ID });

// Delete
await DELETE.from(Claims).where({ ID });
```

### External Service Access

Use `cds.connect.to()` to call external or remote services:

```javascript
const externalService = await cds.connect.to('ExternalService');
const result = await externalService.run(SELECT.from('RemoteEntity').where({ key: value }));
```

### Error Handling

Use CAP's built-in error mechanisms:

```javascript
// Reject request with HTTP error code
req.reject(400, 'Invalid claim data');
req.reject(404, 'Claim not found');

// Add non-fatal error/warning (request continues)
req.error(400, 'Field X is invalid', 'fieldName');
req.warn(200, 'Claim amount is unusually high');
req.info(200, 'Processing complete');
```

## Common Pitfalls

### Draft Semantics
- Draft entities have both active (`IsActiveEntity=true`) and draft (`IsActiveEntity=false`) versions
- Logic in `before`/`after` handlers for draft-enabled entities must account for both active and draft reads
- `SAVE` (draft activation) triggers the full `before CREATE/UPDATE` chain

### Managed Fields
- Never manually set `createdAt`, `createdBy`, `modifiedAt`, `modifiedBy` -- CAP handles these automatically via the `managed` aspect
- If you need to override them (rare), use `req._ = { user: ... }`

### External Service Contracts
- External service models live in `srv/external/`
- Never rename entities in external CDS models -- they must match the remote API
- Configure external service bindings in `package.json` under `cds.requires`

### Transactions
- CAP manages transactions automatically per request
- Use `cds.tx()` only when you need a separate transaction context
- Within a request handler, all CQL operations share the same transaction

### Annotations Over Code
- **Prefer CDS annotations** for behavior that CAP supports declaratively (authorization, validation, draft, side effects)
- Only write custom code for logic that cannot be expressed via annotations
- Keep UI annotations in `app/`, authorization annotations in `srv/*.cds`, domain annotations in `db/schema.cds`
