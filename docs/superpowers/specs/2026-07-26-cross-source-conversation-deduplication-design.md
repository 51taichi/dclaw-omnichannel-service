# Cross-Source Conversation Deduplication Design

## Goal

Prevent one WorkTool message from appearing multiple times after a legacy
customer history import, while preserving genuinely repeated customer messages
and retaining the original stored records for audit.

## Root Cause

Conversation messages can enter the service through three paths:

- live WorkTool callbacks, stored with source `local`;
- customer history import, stored with source
  `worktool_customer_history`;
- WorkTool API command history, stored with source
  `worktool_api_history`.

The current unique index only deduplicates `(bot_id, source, source_key)`.
The same real message therefore remains distinct when it arrives through
different sources. Customer-history source keys also include the current title,
so one historical row can receive different keys after a customer remark or
display-name change.

## Confirmed Behavior

1. New imported rows are checked against existing conversation rows before
   insertion.
2. Existing duplicate rows are not deleted.
3. Conversation read APIs return a deduplicated view so already-stored
   duplicates disappear from the console.
4. Legacy Agent history analysis uses the same deduplicated view so repeated
   rows do not consume the configured history character budget.
5. Two `local` rows are never merged, even when their direction, content, and
   timestamps match. This preserves customers intentionally sending the same
   message twice.
6. A duplicate group must contain at least one imported row.

## Duplicate Identity

Rows are candidates only when all of these match:

- Bot and conversation;
- direction;
- normalized textual content.

Content comparison trims surrounding whitespace and collapses internal
whitespace for comparison only. The selected row keeps its original content.

Timestamp tolerance depends on source:

- same imported source: exact timestamp;
- different imported sources: at most 3 seconds apart;
- one local and one imported row: at most 10 seconds apart;
- two local rows: never duplicates.

Rows with missing or invalid timestamps are not semantically deduplicated.

## Canonical Row

When duplicate candidates are found, retain one row in the returned view using
this preference:

1. `local`;
2. `worktool_customer_history`;
3. `worktool_api_history`;
4. lower database id as the final stable tie-breaker.

This keeps live message identity and rich customer-history media data ahead of
the command-history fallback.

## Import Boundary

`insertImportedConversationMessages` applies the duplicate predicate before
each insert. It skips a new imported row when an existing row is already its
canonical equivalent. The existing external-source unique index remains as a
second idempotency guard.

No migration deletes old data. Existing duplicate rows remain available in raw
logs and database inspection.

## Read Boundary

Both normal conversation reads and evidence-window reads pass rows through one
shared deduplication helper.

Normal reads fetch a bounded surplus before deduplication so the API can still
return close to the requested visible limit. Evidence-window reads preserve the
requested anchor row when it belongs to a duplicate group, so tag-alert
navigation remains stable.

## Agent History Boundary

The bounded legacy-history selector deduplicates imported customer rows before
selecting newest messages against the character limit. Outbound rows remain
excluded as before.

## Testing

Tests must prove:

1. one local row plus its imported equivalent renders once;
2. two identical local rows remain visible;
3. alias-based duplicate customer-history rows render once;
4. customer-history and API-history duplicates render once;
5. rows outside the timestamp tolerance remain distinct;
6. import-time duplicate checks prevent new redundant rows;
7. evidence navigation preserves its requested anchor;
8. Agent history text and character counts exclude duplicate imported rows;
9. Bot and conversation isolation remain unchanged.
