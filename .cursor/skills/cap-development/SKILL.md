---
name: cap-development
description: >-
  SAP CAP backend development guide with CDS MCP tool integration. Use when
  working on CAP backend, CDS models, service definitions, handlers, or CQL
  queries. Covers entity modeling, service patterns, handler delegation, and
  how to use the CDS MCP tools.
---

# CAP Development

## Standards

Read `docs/ai/cap-coding-standards.md` for all coding standards including:
- Project structure and file naming
- CDS modeling patterns (entities, associations, annotations)
- Service definition patterns (projections, authorization)
- Handler delegation pattern (thin handlers -> srv/code/ modules)
- CQL usage (SELECT/INSERT/UPDATE/DELETE)
- Common pitfalls (drafts, managed fields, transactions)

## CDS MCP Tools

Two MCP tools are available for CAP development:

### search_docs

Search CAP documentation for API questions, annotation syntax, or best practices.

**When to use**: unsure about a CAP API, CDS syntax, annotation, or Node.js runtime feature.

```
Tool: search_docs
Parameters:
  query: "your question about CAP"   (required)
  maxResults: 10                      (optional, default 10)
```

Examples:
- `query: "how to register before handler for CREATE event Node.js"`
- `query: "odata draft enabled annotation"`
- `query: "cds.connect.to external service REST"`
- `query: "CQL SELECT with expand associations"`
- `query: "@requires annotation authorization"`

### search_model

Inspect the CDS model of this project -- entities, elements, annotations, endpoints.

**When to use**: need to understand existing entities, check field types, find HTTP endpoints, or see annotations.

```
Tool: search_model
Parameters:
  projectPath: "/Users/soeren.leibach/Projects/insurance-fraud-detection"  (required)
  name: "Claims"              (optional, fuzzy search for definition name)
  kind: "entity"              (optional: service, entity, action, type, etc.)
  topN: 5                     (optional, default 1)
  namesOnly: false            (optional, set true for overview of all definitions)
```

Examples:
- Get overview of all definitions: `namesOnly: true, topN: 50`
- Find entity by name: `name: "Claims", kind: "entity"`
- Find all actions: `kind: "action", topN: 10`
- Inspect a specific service: `name: "ClaimService", kind: "service"`

## Workflow

1. **Before creating/modifying CDS models**: use `search_model` to understand existing definitions
2. **Before writing handlers**: use `search_model` to check entity structure and annotations
3. **When unsure about syntax**: use `search_docs` to find correct CAP API usage
4. **After changes**: verify with `cds watch` that the service boots correctly
