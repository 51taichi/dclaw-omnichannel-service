# DClaw Agent Contract

`worktool-bot-service` calls one DClaw OpenAPI publication per WorkTool `botId`.

## DClaw OpenAPI

The callback server calls:

```text
POST {DClaw Base URL}/api/open/v1/targets/{Public ID}/messages
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

The response is SSE. The callback server joins all text chunks where:

```text
object=content, type=text
```

If the final text is JSON, the callback server tries to extract `reply`.

## WorkTool Message Envelope

The full WorkTool message envelope is embedded into the OpenAPI `message` field.

```json
{
  "channel": "wecom-worktool",
  "botId": "worktool-bot-id",
  "agentId": "dclaw-agent-id",
  "conversationId": "worktool-bot-id:private:user-name",
  "sessionId": "worktool-bot-id:private:user-name",
  "messageId": "worktool-message-id",
  "message": "user visible message",
  "rawMessage": "raw WorkTool message",
  "roomType": 2,
  "groupName": "",
  "userId": "customer name",
  "metadata": {
    "receivedName": "customer name",
    "atMe": "false",
    "textType": 1,
    "fileName": "",
    "filePath": "",
    "payload": {}
  }
}
```

## Agent Response

Preferred output from the DClaw Agent is plain text:

```text
您好，可以的。您想了解加盟条件、费用，还是门店支持？
```

JSON text is also accepted:

The response may use any of these text fields:

```json
{
  "reply": "message to send back",
  "sessionId": "ignored-by-callback-server",
  "handoff": false,
  "metadata": {}
}
```

Text extraction priority:

```text
reply
content
message
text
data.reply
data.content
data.message
```

If no text is returned, the callback server records the invocation but sends no WorkTool reply.

## Conversation Key

The callback server owns the stable external conversation key:

```text
Private chat: botId:private:receivedName
Group chat:   botId:group:groupName
```

The callback server owns session isolation. It always sends `conversation_key` as
both `external_session_id` and the embedded WorkTool `sessionId`.

DClaw may return its own `sessionId` / `session_id`, but the callback server does
not store or reuse it for later turns. This prevents DClaw publication-level
sessions from mixing different WorkTool private chats or groups.
