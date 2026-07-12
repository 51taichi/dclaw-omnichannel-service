---
name: flow_state_machine
description: 当 WorkTool 回调服务器在请求中提供 flow 状态机上下文时，把 flow 作为客户关系推进状态，结合客户问题、知识库和附件返回 reply + attachments + flowDecision JSON。
---

# 客服流程状态机

## 适用场景

当输入 JSON 中包含 `flow` 字段时启用本技能。`flow` 由回调服务器提供，代表当前私聊客户正在执行的业务流程状态机。

如果没有 `flow` 字段，按普通 `customer_reply_flow` 处理：无附件时输出纯文本，有附件时输出 `reply + attachments` JSON。

`flow` 只负责“客户关系推进到哪一步、这一轮是否完成节点、下一步是否要流转”。它不是知识库，不是事实来源，也不能替代客户本轮问题。

## flow 结构

回调服务器会把以下内容放入请求：

```json
{
  "flow": {
    "machine": {
      "name": "流程名称",
      "version": "1.0.0",
      "entryNodeId": "collect_basic_info",
      "nodes": []
    },
    "session": {
      "currentNodeId": "collect_basic_info",
      "collectedData": {}
    },
    "currentNode": {
      "id": "collect_basic_info",
      "name": "收集基础信息",
      "goal": "当前阶段目标",
      "completionCriteria": "节点完成条件",
      "collectFields": ["需要尽量收集的信息"],
      "conversationTips": ["交流技巧"],
      "nextNodeId": "invite_next_step"
    },
    "recentMessages": []
  }
}
```

## 工作方式

1. 读取 `flow.session.currentNodeId` 和 `flow.currentNode`。
2. 先识别客户本轮消息的主要意图：业务事实问题、流程推进信息、异议风险、社交闲聊、无关或敏感内容。
3. 如果客户提出业务事实问题，必须先使用 `dclaw_enterprise_knowledge` 回答；需要沟通策略时再参考 `customer_experience_knowledge`。
4. 在业务问题已被回应之后，再参考当前节点的 `goal`、`collectFields` 和 `conversationTips` 做轻量承接。
5. 使用 `completionCriteria` 判断当前节点是否完成。
6. 参考 `collectFields` 提取客户已经透露的信息。
7. 如果当前节点、企业智库或经验库提供了要发给客户的公开资源，使用 `worktool_attachment_response` 整理 `attachments`。
8. 最终回复文本仍然必须经过 `human_reply_style` 润色；只润色 `reply`，不要删除或改写 `attachments`。
9. 不要为了完成节点而机械追问；客户当前问题必须先被回应。

## 优先级规则

- 安全边界 > 客户当下意图 > 企业智库事实 > 客服经验策略 > 状态机推进 > 真人表达。
- 当前节点目标不能覆盖客户本轮业务问题。
- 如果客户问加盟费、合作政策、品牌情况、产品、流程、合同、资料、售后等问题，即使当前节点是“建立信任”或“邀约活动”，也必须先回答该问题。
- 如果当前节点写了旧业务或与客户问题无关的目标，不要把该目标内容强行发给客户；仅用它判断是否需要保持当前节点或轻量追问。
- 节点推进必须基于客户已经表达的信息和完成条件，不能因为想推进流程而虚构客户已完成。

## 节点推进原则

- 只有当客户表达、上下文或已收集信息确实满足 `completionCriteria` 时，才设置 `nodeCompleted=true`。
- 不确定时保持当前节点，`nodeCompleted=false`。
- 如果客户跳跃式表达了更靠后的意图，可以建议跳转到最合适的节点，但 `nextNodeId` 必须来自 `flow.machine.nodes`。
- 如果当前节点没有 `nextNodeId`，完成后 `nextNodeId` 可以等于当前节点或为空。
- 不要编造已经收集到的信息；`collectedDataPatch` 只能写客户已明确提供或可从上下文稳妥推断的信息。
- `collectedDataPatch` 的 key 必须优先使用 `flow.currentNode.collectFields` 中配置的原始字段名，例如配置为“手机号”就写 `"手机号"`，不要改写成 `"phone"`。
- 如果客户提供的信息对应其他节点的 `collectFields`，也可以使用该字段的原始中文名写入；不要写入未配置的临时字段、总结字段或意图字段。

## 必须输出 JSON

只要输入包含 `flow` 字段，最终只能输出一个 JSON 对象，不能输出纯文本、Markdown、解释或分析过程。

格式如下：

```json
{
  "reply": "发给客户的最终文本",
  "attachments": [],
  "sources": [],
  "flowDecision": {
    "currentNodeId": "当前节点ID",
    "nextNodeId": "建议下一节点ID；不推进时填当前节点ID",
    "nodeCompleted": false,
    "confidence": 0.8,
    "reason": "一句话说明判断依据",
    "collectedDataPatch": {
      "字段名": "本轮新收集的信息"
    }
  }
}
```

## 字段要求

- `reply`：客户可见回复。必须是中文自然客服表达，不要提状态机、节点、JSON、企业智库或内部规则。
- `attachments`：数组。没有资源时使用 `[]`；有图片、文件、视频、音频或链接资源时，按 `worktool_attachment_response` 填写。
- `sources`：数组。只记录实际命中、实际参考、实际用于生成回复的来源；未命中的来源不要写入。
- `currentNodeId`：必须等于 `flow.session.currentNodeId`。
- `nextNodeId`：不推进时等于当前节点；推进时必须是状态机中存在的节点 ID。
- `nodeCompleted`：布尔值。
- `confidence`：0 到 1 的数字。
- `reason`：给回调服务器看的简短判断原因，不要写长篇推理。
- `collectedDataPatch`：对象。没有新增信息时使用 `{}`。

## 示例

### 示例 1：客户问题优先于节点目标

当前节点目标：

```json
{
  "id": "send_material",
  "goal": "确认客户是否领取资料，并在确认后发送资料。",
  "completionCriteria": "客户明确表示需要资料且资料已经发送。",
  "nextNodeId": "invite_next_step"
}
```

客户说：

```text
湘左记这个品牌怎么样？
```

正确输出思路：

- 先按企业智库回答品牌相关事实。
- 不强行发送资料。
- 如果适合，可以轻量承接一句“你是想先了解品牌实力，还是合作政策？”。
- `nodeCompleted=false`，`nextNodeId` 保持当前节点。

输出：

```json
{
  "reply": "湘左记主要做湘味小吃和槟榔相关合作，品牌情况建议先看你关注加盟、产品还是区域政策，我可以按重点给你讲 😊",
  "attachments": [],
  "sources": [],
  "flowDecision": {
    "currentNodeId": "send_material",
    "nextNodeId": "send_material",
    "nodeCompleted": false,
    "confidence": 0.8,
    "reason": "客户询问品牌情况，尚未明确领取资料，当前节点未完成。",
    "collectedDataPatch": {
      "interest": "了解品牌情况"
    }
  }
}
```

输入当前节点：

```json
{
  "id": "collect_basic_info",
  "goal": "了解客户城市、预算和联系方式。",
  "completionCriteria": "客户说明城市和需求，并留下可跟进联系方式。",
  "collectFields": ["city", "budget", "phone"],
  "nextNodeId": "invite_next_step"
}
```

客户说：

```text
我在长沙，想了解加盟，预算大概五万，电话是 18000000000
```

输出：

```json
{
  "reply": "收到，长沙这边可以先按单店加盟思路看，5万预算也有讨论空间。我先把你的情况记下，后面可以按门店位置和投入再细算 😊",
  "attachments": [],
  "sources": [
    {
      "type": "flow_node",
      "name": "收集基础信息",
      "reason": "客户提供城市、预算、需求和联系方式，用于判断当前节点完成"
    }
  ],
  "flowDecision": {
    "currentNodeId": "collect_basic_info",
    "nextNodeId": "invite_next_step",
    "nodeCompleted": true,
    "confidence": 0.9,
    "reason": "客户已提供城市、预算、需求和联系方式，满足基础信息收集条件。",
    "collectedDataPatch": {
      "city": "长沙",
      "budget": "五万",
      "need": "了解加盟",
      "phone": "18000000000"
    }
  }
}
```
