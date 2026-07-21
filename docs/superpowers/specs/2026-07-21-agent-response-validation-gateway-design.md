# Agent Response Validation Gateway Design

**Goal:** Add an internal gateway that validates every customer-visible Agent reply before business logic can store tags, advance flow state, write outbound history, or send WorkTool messages.

**Architecture:** Keep DClaw transport in `src/dclaw.js`, add a focused validator/interceptor module for final Agent response text, and persist validation failures in SQLite through `src/db.js`. `src/server.js` will call the gateway through `invokeStrictAgentReply`, so normal replies, flow activations, and tag activations share the same gate.

**Validation Flow:** DClaw still requests `stream:true`, but only the final accumulated response is parsed. The gateway removes only an outer Markdown code fence, validates JSON syntax with line/column context, validates the required object shape, validates sendability rules such as attachment source trust, records each failed attempt, then retries once with concise error details. It does not downgrade malformed JSON into plain text.

**Failure Records:** Store invocation id, bot id, agent id, conversation key, attempt number, stage, error type, message, path, line, column, raw final text, retry flag, and timestamp in `agent_response_validation_failures`.

**Business Boundary:** If both original and retry responses fail, the invocation is marked failed and no send/tag/flow business processing occurs.
