---
name: worktool_attachment_response
description: 当回复需要携带图片、文件、视频、音频或链接资源时，统一整理 attachments，让回调服务器负责通过 WorkTool 发送。
---

# WorkTool 附件回复协议

## 目标

当任务节点、DClaw 企业智库、客服经验库、会话记录或客户档案中出现可发送资源时，把资源整理进最终输出的 `attachments` 字段。

本 Agent 不直接调用 WorkTool API，不下载、不转存、不上传文件；只返回文本和资源描述。回调服务器负责识别 `attachments` 并发送给客户。

## 什么时候使用

以下情况需要使用本技能：

- 客户明确索要资料、图片、文件、视频或音频。
- 企业智库命中内容中包含公开 URL、网盘地址、资料链接、视频地址、图片地址、音频地址或文件地址。
- 客服经验库提供了适合当前场景的资源链接。
- 状态机当前节点要求发送资料、课程、表单、海报、二维码、视频、合同样例或其他资源。

如果没有可发送资源，按普通文本回复即可。

## 最终输出格式

### 没有 flow 字段

无资源时可以只输出纯文本。

有资源时，最终只能输出一个 JSON 对象：

```json
{
  "reply": "发给客户的文本",
  "attachments": [
    {
      "type": "video",
      "url": "https://example.com/招商介绍.mp4",
      "name": "招商介绍.mp4",
      "title": "湘左记招商介绍"
    }
  ]
}
```

### 有 flow 字段

只要输入包含 `flow`，最终仍然必须输出 `flow_state_machine` 的 JSON，并在同一对象里加入 `attachments`：

```json
{
  "reply": "发给客户的文本",
  "attachments": [
    {
      "type": "file",
      "url": "https://example.com/招商资料.pdf",
      "name": "湘左记招商资料.pdf",
      "title": "湘左记招商资料"
    }
  ],
  "flowDecision": {
    "currentNodeId": "send_material",
    "nextNodeId": "invite_next_step",
    "nodeCompleted": true,
    "confidence": 0.9,
    "reason": "客户明确索要资料，已随回复发送资料。",
    "collectedDataPatch": {}
  }
}
```

没有资源时也可以输出 `"attachments": []`，不要为了凑字段编造资源。

## type 规则

`attachments[].type` 只能优先使用以下值：

- `image`：图片，例如 jpg、jpeg、png、gif、webp。
- `video`：视频，例如 mp4、mov、m4v、avi。
- `audio`：音频，例如 mp3、wav、m4a、aac。
- `file`：通用文件，例如 pdf、doc、docx、xls、xlsx、ppt、pptx、zip。
- `link`：网页、网盘、小程序页面、表单、文章、落地页或无法判断类型的 URL。

如果知识内容明确写了“图片地址/视频地址/音频地址/文件地址”，优先按字段语义判断类型。

如果只能从扩展名判断，按扩展名判断。

如果是夸克网盘、百度网盘、网页、H5、小程序落地页、表单地址、文章地址，统一用 `link`。

## 字段规则

- `url` 必填，必须是客户可访问的公开 `http://` 或 `https://` 链接，优先使用 `https://`。
- `name` 可选，用于文件名；如果资料本身有文件名，尽量填写。
- `title` 可选，用于给服务器或后续记录识别资源。
- 不要输出本地路径，例如 `/app/...`、`C:\...`、`./资料.pdf`。
- 不要输出需要内部登录、Agent 工作区权限或平台私有权限才能访问的链接。
- 不要编造 URL；没有明确 URL 就不要放进 `attachments`。

## 多资源规则

- 客户只要一个资料时，优先发送最相关的 1 个资源。
- 客户明确要完整资料包时，可以返回多个附件，但建议不超过 3 个。
- `reply` 里要自然说明“我把资料发你了”“这个视频你可以先看下”，不要把每个附件 URL 都重复写一遍。
- 如果 `type` 是 `link`，服务器可能会以文本 URL 形式发送；这类链接可以在 `reply` 里轻轻提示。

## 和其他技能的关系

- `dclaw_enterprise_knowledge`：负责从企业智库识别事实和资源 URL。
- `customer_experience_knowledge`：只提供沟通策略和显式资源链接，不能编造事实资源。
- `flow_state_machine`：负责判断节点是否完成；如果节点目标是发资料，发送成功的意图由 `attachments` 表达。
- `human_reply_style`：只润色 `reply` 字段，不得删除、改写或吞掉 `attachments`。

## 示例

客户说：

```text
给我发下招商资料
```

企业智库命中：

```text
湘左记招商资料PDF：https://cdn.example.com/xzj/join.pdf
```

最终输出：

```json
{
  "reply": "可以呀，我把招商资料先发你，你可以重点看费用和流程这两块 👌",
  "attachments": [
    {
      "type": "file",
      "url": "https://cdn.example.com/xzj/join.pdf",
      "name": "湘左记招商资料.pdf",
      "title": "湘左记招商资料"
    }
  ]
}
```

客户说：

```text
有品牌介绍视频吗
```

企业智库命中：

```text
品牌介绍视频：https://cdn.example.com/xzj/brand.mp4
```

最终输出：

```json
{
  "reply": "有的，我把品牌介绍视频发你，先看整体感觉就行 📌",
  "attachments": [
    {
      "type": "video",
      "url": "https://cdn.example.com/xzj/brand.mp4",
      "name": "湘左记品牌介绍.mp4",
      "title": "湘左记品牌介绍视频"
    }
  ]
}
```
