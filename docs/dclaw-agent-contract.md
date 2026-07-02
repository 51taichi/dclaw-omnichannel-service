# DClaw Agent Contract

`worktool-bot-service` calls one DClaw Agent per WorkTool `botId`.

## Request

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

## Response

The response may use any of these text fields:

```json
{
  "reply": "message to send back",
  "sessionId": "optional-dclaw-session-id",
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

If DClaw returns a `sessionId`, the callback server stores it and sends it on later turns.
