# Inbound Agent Attachments Design

## Goal

Allow WorkTool inbound image and file callbacks in private chats and group chats to reach the DClaw Agent as structured, readable attachment references, while preserving the existing callback audit tables, conversation history, WorkTool delivery queues, flow state machine, tag handling, and reply validation behavior.

## Current Behavior

WorkTool message callbacks are stored in `incoming_messages.payload_json` before business processing. Private and group callbacks are also stored in `conversation_messages.raw_payload_json`, with visible text copied from `spoken` or `rawSpoken`.

Non-text callbacks that do not include `spoken` or `rawSpoken` are currently recorded and then skipped by `shouldProcessInboundForAgent()`. The DClaw request only includes bounded text plus `fileName` and `filePath` metadata. This records that an image or file happened, but does not reliably give the Agent a usable attachment reference.

## Architecture

Add a narrow inbound attachment adapter owned by the WorkTool callback pipeline. The adapter extracts known attachment fields from the raw WorkTool callback, normalizes them into a stable `inboundAttachments` array, and builds a human-readable placeholder when the callback has no text. The existing DClaw request builder will include these normalized attachments under `worktoolMessage.metadata.inboundAttachments` and `worktoolMessage.metadata.payload.inboundAttachments`.

If WorkTool provides an HTTP or HTTPS `fileUrl`/`filePath`, the server passes that URL through. If WorkTool only provides a non-public path, a later fetch/cache branch may create a public URL using the existing upload/static file infrastructure. The first implementation keeps that branch explicit and non-invasive: unsupported local-only paths remain recorded but are marked unavailable instead of being guessed.

## Data Contract

`inboundAttachments` items use:

```json
{
  "type": "file",
  "url": "https://example.test/resume.pdf",
  "name": "张三简历.pdf",
  "textType": 6,
  "source": "worktool_callback",
  "available": true
}
```

Allowed `type` values are `image`, `file`, `video`, `audio`, and `unknown`. `url` may be empty when WorkTool did not provide a usable public URL; such items remain useful as audit metadata but must not be described to the Agent as readable content.

## Flow

1. WorkTool calls `/worktool/:botId/message-callback` or the legacy callback route.
2. The raw callback is inserted into `incoming_messages` exactly as today.
3. Private and group callbacks are inserted into `conversation_messages` exactly as today, except empty attachment messages get a stable visible placeholder such as `[文件] 张三简历.pdf`.
4. `shouldProcessInboundForAgent()` allows a callback when it has text or at least one available inbound attachment.
5. `buildDclawRequest()` includes `inboundAttachments` in request metadata.
6. DClaw Agent decides how to read PDF, image, Word, Excel, or other files using its own skills. Middle platform does not hard-code resume parsing, Excel generation, or template filling.

## Boundaries

- Do not change WorkTool outbound media sending or Agent `attachments` reply semantics.
- Do not change group reply authorization, at-mention policy, flow state machine, tag decisions, handoff, coalescing, or activation cancellation.
- Do not infer file contents from filenames or placeholders.
- Do not store generated Excel logic in the middle platform.
- Do not require every customer message to have an attachment; text-only behavior remains unchanged.

## Error Handling

Malformed attachment fields are ignored for Agent eligibility but remain in raw payload audit storage. Non-public paths are preserved as unavailable metadata. If a callback has only unavailable attachments and no text, it remains recorded and skipped for Agent invocation, matching current safety behavior.

## Testing

Tests should prove:

- attachment-only callbacks with public URLs are eligible for Agent processing;
- attachment-only callbacks without public URLs remain recorded but are not processed;
- DClaw request metadata contains normalized inbound attachments;
- text-only callbacks and friend-added callbacks keep existing behavior;
- conversation history uses placeholders for attachment-only visible content without losing raw payload.
