# Manual Reply Console Design

## 背景

当前人工接手后，如果员工直接在微信/企微客户端回复客户，WorkTool 仍然可以完成真实发送，但 `worktool-bot-service` 不知道这条 outbound 消息，因此控制台会话记录和服务端数据库会缺失人工回复。为保证人工接手期间的完整会话记录，控制台需要提供一个服务端发送入口。

自动刷新当前会话记录作为第二阶段实现，本设计先完成“人工接手时可从控制台发文本和 emoji”的闭环。

## 范围

本阶段只支持私聊会话的文本 + emoji 人工回复，不支持图片、音频、视频或文件。图片/文件后续可以复用主动推送的上传与媒体发送能力。

## 用户体验

每个客户会话记录区域底部新增一个聊天输入区。

当会话处于 `AI接待中`：

- 输入区不可操作。
- 显示提示图，使用用户提供的 `Image 19.png`，实现时复制到 `public/console/assets/ai-chatting.png`。
- 提示文案表达 AI 正在接管，切换人工接手后可以手动回复。
- 发送按钮禁用。

当会话处于 `人工接手中`：

- 显示可编辑文本框。
- 支持常用 emoji 快捷插入。
- 允许纯 emoji 消息。
- 空消息不可发送。
- 点击发送后由服务端调用 WorkTool 发送，并写入会话记录。
- 发送成功后刷新当前会话记录或追加返回消息。

## 服务端接口

新增接口：

```http
POST /api/flow-sessions/:conversationKey/manual-reply
```

请求体：

```json
{
  "botId": "wtepx...",
  "content": "好的，我帮您看一下 😊"
}
```

校验规则：

- 调用者必须拥有该 bot 的访问权限。
- `botId` 必填。
- `content` trim 后不能为空。
- 会话必须存在。
- 会话必须属于该 bot。
- 会话必须处于 `handoffStatus = human`。
- 只允许私聊会话，`conversationKey` 必须包含 `:private:`。
- bot 绑定必须启用。

发送流程：

1. 从 `conversationKey` 解析私聊目标名。
2. 调用 WorkTool `sendTextMessage({ robotId: botId, targets: [targetName], content })`。
3. 写入 `conversation_messages`：
   - `direction = outbound`
   - `senderName = botName || agentName || "人工客服"`
   - `content = content`
   - `rawPayload.source = manual_reply`
4. 写入 `outgoing_messages`：
   - `agentId = binding.agentId`
   - `targetName = targetName`
   - `worktoolResponse = WorkTool result`
5. 返回发送后的消息对象和 WorkTool messageId。

失败策略：

- WorkTool 发送失败时，不写 outbound 会话记录。
- 前端显示 toast 错误。
- 服务端记录 `manual_reply.failed` 日志。

## 控制台改动

`public/console/index.html`：

- 在 `chatMessages` 下方增加 `manualReplyComposer`。
- 包含 AI 接管提示区、文本输入区、emoji 面板和发送按钮。

`public/console/app.js`：

- 增加 DOM refs。
- 根据 `currentFlowSession.handoffStatus` 渲染 composer 状态。
- `AI接待中` 展示提示图并禁用输入。
- `人工接手中` 启用输入和发送按钮。
- emoji 按钮将表情插入当前光标位置。
- 发送成功后清空输入，并重新加载当前会话。

`public/console/styles.css`：

- 新增 composer、AI 提示图、emoji toolbar、发送按钮样式。
- 输入区高度紧凑，贴近微信/QQ 对话输入体验。

## 数据一致性

人工回复必须通过服务端发送才会入库。控制台应通过 UI 提醒员工：人工接手后建议在控制台回复，避免微信客户端直回导致记录缺失。

后续第二阶段自动刷新时，当前选中的会话会定时拉取最新记录，以便看到客户新消息和人工发送结果。

## 测试

新增边界测试：

- server 暴露 `/api/flow-sessions/:conversationKey/manual-reply`。
- server 校验 `handoffStatus === "human"`。
- server 调用 `sendTextMessage` 后写入 `insertConversationMessage` 和 `insertOutgoingMessage`。
- console 包含 `manualReplyComposer`。
- console 包含 AI 接管提示图资源引用。
- console 包含 emoji 快捷按钮和手动发送请求。

实现后运行：

```bash
npm test
node --check src/server.js
node --check public/console/app.js
```

## 非目标

- 本阶段不做图片/文件/音视频人工发送。
- 本阶段不做当前会话自动刷新。
- 本阶段不改变 AI 接待逻辑。
- 本阶段不改变 WorkTool 回调绑定。
