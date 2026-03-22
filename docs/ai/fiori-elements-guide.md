# Fiori Elements Guide

Authoritative guide for building SAP Fiori Elements UIs in this project. The core principle: **annotation-driven development** -- define UI behavior via CDS annotations, not custom code.

## Architecture

```
app/
└── claims/                        # One folder per Fiori app
    ├── annotations.cds            # UI annotations for this app
    ├── webapp/
    │   ├── manifest.json          # App descriptor
    │   ├── Component.js           # UI5 component (usually generated)
    │   └── i18n/
    │       └── i18n.properties    # Translations
    ├── ui5.yaml                   # UI5 tooling config
    └── package.json               # App-level dependencies
```

- Keep **service definitions clean** in `srv/*.cds` -- no UI annotations there
- All **UI annotations** go in `app/<appname>/annotations.cds`
- The CDS compiler automatically loads all `.cds` files from `app/` subfolders

## Annotation-Driven Development

Fiori Elements generates the entire UI from OData annotations. Write CDS annotations instead of custom UI5 code.

### List Report Page

```cds
using ClaimService as service from '../../srv/ClaimService';

annotate service.Claims with @(
  UI: {
    SelectionFields: [ status_code, claimType_code, createdAt ],
    LineItem: [
      { Value: title, Label: 'Title' },
      { Value: claimType.name, Label: 'Type' },
      { Value: claimAmount, Label: 'Amount' },
      { Value: fraudScore, Label: 'Fraud Score', Criticality: scoreCriticality },
      { Value: status.name, Label: 'Status', Criticality: statusCriticality },
      { Value: createdAt, Label: 'Created' }
    ]
  }
);
```

### Object Page

```cds
annotate service.Claims with @(
  UI: {
    HeaderInfo: {
      TypeName: 'Claim',
      TypeNamePlural: 'Claims',
      Title: { Value: title },
      Description: { Value: description }
    },
    HeaderFacets: [
      { $Type: 'UI.ReferenceFacet', Target: '@UI.FieldGroup#Status' }
    ],
    Facets: [
      { $Type: 'UI.ReferenceFacet', Label: 'General', Target: '@UI.FieldGroup#General' },
      { $Type: 'UI.ReferenceFacet', Label: 'Attachments', Target: 'attachments/@UI.LineItem' },
      { $Type: 'UI.ReferenceFacet', Label: 'Prediction', Target: '@UI.FieldGroup#Prediction' }
    ],
    FieldGroup#General: {
      Data: [
        { Value: title },
        { Value: description },
        { Value: claimAmount },
        { Value: currency_code },
        { Value: claimType_code }
      ]
    },
    FieldGroup#Status: {
      Data: [
        { Value: status_code, Criticality: statusCriticality },
        { Value: createdAt },
        { Value: modifiedAt }
      ]
    },
    FieldGroup#Prediction: {
      Data: [
        { Value: fraudScore, Label: 'Fraud Score' },
        { Value: evaluationSummary, Label: 'Evaluation' }
      ]
    }
  }
);
```

### Common Annotation Patterns

| Annotation | Purpose |
|------------|---------|
| `@UI.LineItem` | Columns in list/table |
| `@UI.SelectionFields` | Filter bar fields |
| `@UI.HeaderInfo` | Object page header |
| `@UI.Facets` | Object page sections |
| `@UI.FieldGroup` | Grouped fields in a section |
| `@UI.DataPoint` | KPI / header data point |
| `@UI.Chart` | Analytical chart |
| `@UI.Identification` | Actions on the object page |
| `@Common.ValueList` | Value help / dropdown |
| `@Common.Text` | Display text for code fields |
| `@Common.TextArrangement` | How code + text are shown (#TextOnly, #TextFirst) |

### Value Help

```cds
annotate service.Claims with {
  status @Common.ValueList: {
    CollectionPath: 'ClaimStatuses',
    Parameters: [
      { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: status_code, ValueListProperty: 'code' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
    ]
  };
};
```

### Criticality (Color Coding)

Use virtual elements or calculated fields for criticality:

```cds
// In service CDS
entity Claims as projection on db.Claims {
  *,
  // Virtual element for UI criticality
  null as statusCriticality : Integer
};
```

```javascript
// In after READ handler
if (claim.status_code === 'fraud_detected') claim.statusCriticality = 1; // Red
if (claim.status_code === 'cleared') claim.statusCriticality = 3;        // Green
if (claim.status_code === 'pending') claim.statusCriticality = 2;        // Yellow
```

## Rules

- **Never** build custom UI5 views/controllers when Fiori Elements annotations can achieve the same result
- **Always** place UI annotations in `app/<appname>/annotations.cds`, not in `srv/` or `db/`
- **Use** `@Common.Text` with `@Common.TextArrangement` for code list fields to show human-readable labels
- **Use** `@odata.draft.enabled` in the service CDS for editable entities
- **Prefer** `@title` in domain models over `Label` in annotations (DRY)
- When in doubt about annotation syntax, consult the Fiori MCP `search_docs` tool (Cursor) or the [SAP Fiori Elements documentation](https://ui5.sap.com/)
