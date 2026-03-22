---
name: fiori-elements-development
description: >-
  SAP Fiori Elements UI development with Fiori MCP tool integration. Use when
  working on UI, Fiori Elements, annotations, frontend apps, List Report,
  Object Page, or UI5 configuration.
---

# Fiori Elements Development

## Standards

Read `docs/ai/fiori-elements-guide.md` for all Fiori Elements patterns including:
- Annotation-driven development philosophy
- List Report and Object Page annotations
- Common annotation patterns (LineItem, HeaderInfo, Facets, FieldGroup, ValueList)
- Criticality (color coding)
- File placement rules (annotations in `app/<appname>/annotations.cds`)

## Fiori MCP Tools

### search_docs

Search Fiori Elements, SAPUI5, and Fiori Tools documentation.

**When to use**: unsure about annotation syntax, Fiori Elements features, or UI5 APIs.

```
Tool: search_docs
Parameters:
  query: "your Fiori question"   (required)
  maxResults: 25                  (optional, default 25)
```

Examples:
- `query: "UI.LineItem annotation for list report"`
- `query: "Object Page facets and sections"`
- `query: "Common.ValueList value help dropdown"`
- `query: "side effects annotation"`

### 3-Step App Modification Workflow

For creating or modifying Fiori apps, follow this exact sequence:

#### Step 0 (optional): Find the app

```
Tool: list_fiori_apps
Parameters:
  searchPath: ["/Users/soeren.leibach/Projects/insurance-fraud-detection/app"]
```

#### Step 1: List available functionalities

```
Tool: list_functionality
Parameters:
  appPath: "/Users/soeren.leibach/Projects/insurance-fraud-detection/app/<appname>"
```

Returns IDs of supported operations (add column, add filter, add page, etc.).

#### Step 2: Get details for a functionality

```
Tool: get_functionality_details
Parameters:
  appPath: "/Users/soeren.leibach/Projects/insurance-fraud-detection/app/<appname>"
  functionalityId: "<id from step 1>"
```

Returns required parameters for executing the functionality.

#### Step 3: Execute the functionality

```
Tool: execute_functionality
Parameters:
  appPath: "/Users/soeren.leibach/Projects/insurance-fraud-detection/app/<appname>"
  functionalityId: "<id from step 2>"
  parameters: { <parameters from step 2> }
```

## Rules

- Always try the Fiori MCP 3-step workflow before manually editing annotations
- Use `search_docs` when unsure about annotation syntax
- If the MCP doesn't support a functionality, fall back to manual annotation editing following `docs/ai/fiori-elements-guide.md`
