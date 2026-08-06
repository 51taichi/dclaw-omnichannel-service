# DClaw Agent Contract

The omnichannel service calls one DClaw OpenAPI publication for each configured Bot binding.

## DClaw OpenAPI

```text
POST {DClaw Base URL}/api/open/v1/targets/{Public ID}/messages
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

The response is an SSE stream. The service joins text chunks whose event payload identifies them as text content, then validates the resulting Agent response before any customer delivery.

## Standard Channel Message

The OpenAPI `message` contains instructions followed by a JSON payload with a provider-neutral `channelMessage` object:

```json
{
  "channelMessage": {
    "channel": "whapi",
    "eventType": "inbound_message",
    "botId": "bot-id",
    "agentId": "dclaw-agent-id",
    "conversationId": "ch-c-stable-runtime-id",
    "sessionId": "ch-c-stable-runtime-id",
    "messageId": "whapi-message-id",
    "message": "customer-visible message",
    "rawMessage": "raw inbound message",
    "roomType": 2,
    "groupName": "",
    "userId": "stable participant id",
    "metadata": {
      "localConversationId": "whapi:account-id:private:participant-id",
      "receivedName": "customer display name",
      "atMe": "false",
      "textType": 1,
      "fileName": "",
      "filePath": "",
      "inboundAttachments": [],
      "payload": {}
    }
  },
  "generalRule": "",
  "conversationReset": false
}
```

Depending on the active business features, the payload can also include `flow`, `groupContext`, `groupTurns`, `tagRules`, and `tagEvidenceCandidates`.

## Agent Response

The Agent must return exactly one JSON object. A basic response is:

```json
{
  "reply": "message to send to the customer",
  "attachments": [],
  "sources": []
}
```

Flow-enabled requests additionally require `flowDecision`. Tag-enabled requests additionally require `tagEvaluation` and `tagDecision`. The service validates and, when appropriate, retries malformed output before delivery. It never forwards unvalidated raw Agent output to WhatsApp.

An authorized customer request must contain either non-empty `reply` text or at least one valid attachment. Background tasks that explicitly allow silence may return empty reply and attachment arrays.

## Conversation Isolation

The service derives conversation identity from the provider, channel account, chat type, and stable external chat or participant ID. Display names are never identity keys.

The derived runtime identity is sent as both `external_session_id` and `channelMessage.sessionId`. A session identifier returned by DClaw is not reused for later turns, preventing conversations from different accounts, private chats, or groups from mixing.
