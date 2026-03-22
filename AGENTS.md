# AGENTS.md

Compact rules for Claude Code sub-agents working in this repository.

## Critical Rules

1. **Folder structure**: domain models in `db/`, service definitions + thin handlers in `srv/`, implementation logic in `srv/code/`, UI in `app/`
2. **Handler delegation**: `srv/*.js` files are wiring only -- all business logic goes in `srv/code/<entity>-<phase>-<event>-logic.js`
3. **CQL only**: use `SELECT`, `INSERT`, `UPDATE`, `DELETE` from `cds.ql` -- never raw SQL
4. **SAP AI SDK**: use `@sap-ai-sdk/foundation-models` (`AzureOpenAiChatClient`) for all LLM calls
5. **Annotations first**: prefer CDS annotations over custom code for authorization, validation, UI, and draft behavior

## Full Standards

Read `docs/ai/cap-coding-standards.md` for comprehensive CAP coding standards, patterns, and examples.
