# Historical Outbound Sender Name Design

## Problem

WorkTool customer-history rows and cached API-command rows identify the conversation target with
`titleList` or `targetName`. The legacy importer currently stores those customer-facing identifiers
as `sender_name` even when the normalized message direction is `outbound`. The console trusts
`sender_name`, so imported Bot replies appear to have been sent by the customer.

## Design

The legacy-history service receives a Bot display-name resolver. It uses the customer title only for
`inbound` messages and uses the resolved Bot name for every `outbound` customer-history or API-history
message. The resolver falls back from `botName` to `agentName` and finally to `机器人`.

Service startup runs one idempotent database migration. It changes only rows whose source is
`worktool_customer_history` or `worktool_api_history` and whose direction is `outbound`. It preserves
message IDs, content, direction, timestamps, raw payloads, source keys, local messages, and inbound
messages. A setting marker prevents repeated full-table updates.

## Verification

- A service test proves inbound history keeps the customer name while outbound history uses the Bot.
- A service test proves cached API replies use the Bot name.
- A database test proves existing imported outbound rows are corrected exactly once and unrelated
  rows remain unchanged.
- The focused suites and complete test suite must pass before pushing.
