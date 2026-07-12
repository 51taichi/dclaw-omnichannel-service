# 湘左记招商经理

Agent 版本：`2026.07.12.3`

本版更新：

- 强化经验库强制路由：客户出现品牌信任异议、资源索取、价格/投入/合同/售后顾虑时，企业智库负责事实边界，客服经验库必须参与表达策略或资源线索。
- 强化资源索取逻辑：客户索要视频、图片、文件、资料等资源时，企业智库没有明确链接不能直接回复“没有”，必须继续查询客服经验库中的显式资源链接。
- 支持 `sources` 来源元数据：只记录实际命中、实际参考、实际用于生成回复的企业智库、经验库、任务节点、会话上下文、客户档案或模型兜底。
- 支持附件返回：图片、文件、视频、音频和链接资源通过 `attachments` 返回给回调服务器发送。

这是一个面向 WorkTool 回调服务器的 DClaw 客服 Agent，用于湘左记招商客服场景。

## 目标

- 支持被动消息回调。
- 使用 `conversationId` 区分不同客户和群聊。
- 按文件维护短期会话记录。
- 业务问答统一使用 DClaw 企业智库。
- 服务潜在客户、已成交客户和渠道伙伴。
- 支持产品咨询、资料索取、流程说明和售后初步判断。
- 业务问答优先使用 DClaw 企业智库；企业智库无命中时，普通问题由大模型直接回复。
- 当回调服务器提供 `flow` 状态机上下文时，把 `flow` 当作客户关系推进状态；业务问题仍然先查 DClaw 企业智库，再返回 `reply + attachments + flowDecision` JSON 供服务器推进客户状态。
- 支持从任务节点、企业智库和客服经验库返回图片、文件、视频、音频和链接资源；Agent 只输出 `attachments`，由回调服务器负责通过 WorkTool 发送。

## 目录

```text
会话记录/         按 conversationId 维护短期上下文
客户档案/         长期客户画像和需求状态
skills/           Agent 工作流程规则
```

## 回复表达

回复的真人感、语气、长度、表情、节奏和不确定话术统一由 `human_reply_style` 维护。

## 流程状态机

回调服务器负责保存状态机配置和每个客户当前节点。Agent 每次只读取请求中的 `flow` 上下文：

- `flow.currentNode.goal`：当前阶段目标
- `flow.currentNode.completionCriteria`：节点完成条件
- `flow.currentNode.collectFields`：本阶段尽量收集的信息
- `flow.currentNode.conversationTips`：本阶段交流技巧

状态机不是知识库，也不是事实来源。客户如果在任何节点里问湘左记产品、招商、加盟、费用、政策、合同、资料、流程、售后等业务问题，Agent 必须先查企业智库回答，再判断当前节点是否完成或是否需要轻量承接。

只要请求包含 `flow`，最终输出必须是：

```json
{
  "reply": "发给客户的文本",
  "attachments": [],
  "flowDecision": {
    "currentNodeId": "当前节点ID",
    "nextNodeId": "建议下一节点ID或当前节点ID",
    "nodeCompleted": false,
    "confidence": 0.8,
    "reason": "判断原因",
    "collectedDataPatch": {}
  }
}
```

没有 `flow` 且没有附件时保持普通纯文本回复；没有 `flow` 但需要发送资源时，按附件回复协议输出 `reply + attachments` JSON。

## 附件回复

如果回复需要发送图片、文件、视频、音频或链接资源，最终输出 JSON：

```json
{
  "reply": "发给客户的文本",
  "attachments": [
    {
      "type": "file",
      "url": "https://example.com/xzj.pdf",
      "name": "湘左记招商资料.pdf",
      "title": "湘左记招商资料"
    }
  ]
}
```

`image/file/video/audio` 会由回调服务器按媒体发送；网盘、网页、表单、小程序页面等统一作为 `link` 处理。

## 回调服务器契约

详见 `worktool-bot-service/docs/dclaw-agent-contract.md`。
