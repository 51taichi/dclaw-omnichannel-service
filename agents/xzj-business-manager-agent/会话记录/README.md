# 会话记录

本目录按 `conversationId` 保存短期会话上下文。

推荐文件命名：

```text
conversations/<sha256(conversationId)>.md
```

如果当前环境不方便计算 hash，可以使用安全 slug，但文件头必须保留原始 `conversationId`。

## 会话文件模板

```md
---
conversationId: ""
botId: ""
userId: ""
groupName: ""
roomType: 2
updated: YYYY-MM-DD
---

# 会话记录

## 当前状态

客户当前在咨询什么，已确认哪些信息，还有哪些待确认。

## 重要事实

- 

## 最近对话

- 用户：
- 客服：

## 待办与风险

- 
```

## 清理规则

- 不自动压缩会话。
- 可以定期清理 7 天未更新的会话文件。
- 用户明确要求“清空会话”“重新开始”“忘记前面”时，只清空当前 conversationId 的短期会话记录。

