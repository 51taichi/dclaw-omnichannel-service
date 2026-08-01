# 夜间企微客户标签同步设计

## 背景

控制台当前以内部标签作为业务事实来源。Agent 自动打标、人工打标和客户添加日期标签都会实时写入本地数据库，但不会同步到企业微信客户标签。

WorkTool 的“修改好友信息”指令可以为企业微信好友添加标签。实际验证结果表明：

- 使用 `type=213` 和 `friend.tagList` 可以成功添加标签。
- WorkTool 当前客户端表现为追加标签；提交 `VIP` 后，已有的 `A类` 不会消失。
- 官方接口没有提供独立的删除标签参数。
- `type=214` 不是当前可用的修改好友指令。
- WorkTool 指令先进入客户端队列，再由客户端顺序执行。

标签同步属于低优先级维护动作。白天客户消息回复和现有客户可见动作必须保持当前行为，因此同步应主要在每个 Bot 的夜间维护时间段执行，并且不得重构现有回复、激活或主动推送链路。

参考接口：

- [WorkTool 修改好友信息](https://worktool.apifox.cn/api-48509625)
- [WorkTool 指令执行结果查询](https://worktool.apifox.cn/api-43575628)

## 目标

- 将内部私聊客户标签增量同步到企业微信客户标签。
- 同步所有标签，包括普通标签、人工标签和客户添加日期标签。
- 每个 Bot 独立配置夜间维护时间段，默认使用北京时间 `03:00-06:00`。
- 首次启用时补同步当前 Bot 全部私聊客户已有标签。
- 后续在内部标签新增时实时登记待同步记录，夜间再提交 WorkTool。
- 支持管理员在当前 Bot 配置页手动触发立即同步，便于测试。
- 同步记录持久化，服务重启、容器更新和任务中断后可以继续。
- 客户消息到达时暂停领取新的同步任务，回复提交后自动恢复。
- 标签同步失败不影响内部标签、DClaw 调用、客户回复、激活或主动推送。

## 非目标

- 不删除企业微信已有标签。
- 不让企业微信标签反向覆盖内部标签。
- 不校验或阻止不同标签组使用相同标签名称。
- 不为每个标签增加“是否同步”开关。
- 不同步群聊标签；修改好友信息接口只用于私聊客户。
- 不实现批量删除好友。
- 不建立或改造统一的 WorkTool 出站优先级队列。
- 不改变 AI 回复、人工回复、客户激活、标签激活和主动推送之间的现有关系。

## 核心原则

### 内部标签是事实来源

内部标签继续实时生效，并驱动筛选、标签激活和控制台展示。企业微信标签只是异步派生结果。同步失败时不回滚、不延迟也不阻止内部打标。

### 只追加，不删除

内部新增标签会登记同步任务。内部删除、互斥替换或状态升级不会删除企微旧标签，只会继续追加新的标签。例如内部标签从 `C类` 变为 `B类`，企微可能同时保留 `C类` 和 `B类`，该行为符合当前确认边界。

### 旧核心链路保持不变

现有客户可见动作继续直接使用当前代码路径提交 WorkTool。本功能只新增一个主动避让的低优先级标签同步 worker，不接管、不重排、不包装旧发送链路。

## 数据模型

### bot_tag_sync_configs

每个 Bot 一条同步配置：

```text
bot_id                 PRIMARY KEY
enabled                INTEGER
window_start           HH:mm，默认 03:00
window_end             HH:mm，默认 06:00
timezone               默认 Asia/Shanghai
initial_backfill_at    首次全量登记完成时间，可空
created_at
updated_at
```

- 维护时间段支持跨零点。
- 关闭同步只停止领取新任务，不删除 Outbox。
- 重新启用后继续处理原有待同步记录。

### tag_sync_outbox

每个待同步客户标签一条持久化记录：

```text
id                     PRIMARY KEY AUTOINCREMENT
bot_id
agent_id
conversation_key
target_name            登记时客户名称，仅作为审计快照
tag_name
status                 pending / processing / succeeded / failed
attempt_count
next_retry_at
claimed_at
lease_expires_at
worktool_message_id
last_error
created_at
updated_at
succeeded_at
```

约束和索引：

- 对同一 Bot、私聊会话和标签名称建立唯一约束，防止同一标签反复打标产生重复任务。
- 为 `bot_id + status + next_retry_at` 建立领取索引。
- `target_name` 不是执行时的唯一可信名称。提交前应从当前会话数据重新解析最新客户名称。
- 相同名称存在于不同内部标签组时，系统不做业务校验；企微侧如何呈现由客户配置承担。

### tag_sync_runs

记录每次计划或人工执行：

```text
id                     PRIMARY KEY AUTOINCREMENT
bot_id
trigger_type           scheduled / manual
status                 running / paused / completed / stopped
pending_before
succeeded_count
failed_count
started_at
finished_at
last_error
```

- 同一 Bot 同时只允许一个运行中的同步 run。
- 多个 Bot 可以并行运行，因为它们对应独立 WorkTool 客户端队列。

## Outbox 登记

### 首次启用

管理员首次启用某个 Bot 的企微标签同步时：

1. 在事务中保存启用配置。
2. 查询该 Bot 当前所有私聊客户的 `conversation_tags`。
3. 将普通标签、人工标签和日期标签登记为 `pending`。
4. 使用唯一约束跳过重复记录。
5. 完成后写入 `initial_backfill_at`。

首次启用只登记数据，不立即提交 WorkTool。记录等待下一个维护窗口，或由管理员点击“立即同步”。

### 后续增量

所有私聊标签新增入口在原有标签事务中同时登记 Outbox，包括：

- Agent 自动打标。
- 控制台人工打标。
- 新好友添加日期标签。
- 旧客户历史加载产生的日期标签。
- 其他现有私聊标签写入路径。

Outbox 写入失败时标签事务整体失败，避免出现内部标签已新增但永远没有同步记录。Outbox 写入本身不发起网络请求，因此不会增加回复等待时间。

内部标签删除不创建任何同步记录。群聊会话不创建好友标签同步记录。

## 调度模型

### 夜间维护窗口

- 每个 Bot 使用自己的维护时间段和时区判断是否允许运行。
- 默认时区为 `Asia/Shanghai`，默认窗口为 `03:00-06:00`。
- 服务在窗口开始后创建或恢复一个 `scheduled` run。
- 服务在窗口内重启时，应自动继续当前 Bot 未完成的同步。
- 窗口内新产生的待同步记录也属于本次清空范围。
- 到结束时间后停止领取新记录；未完成记录保持原状态，下一次窗口继续。
- 跨零点窗口按本地时间正确计算。

### 管理员立即同步

- 仅当前 Bot 的管理员可以触发。
- `manual` run 不受维护时间段限制。
- 与夜间任务使用完全相同的 worker、领取、暂停、回调和重试逻辑。
- 目标是清空当前 Bot 的 `pending/failed` 记录。
- 同一 Bot 已有运行中 run 时，重复点击不创建第二个 run。

### 单指令执行

同一 Bot 同时最多存在一条标签同步 WorkTool 指令：

1. worker 原子领取一位客户的可执行 Outbox 记录。
2. 提交前解析客户当前名称。
3. 合并该客户待同步标签，每条 WorkTool 指令最多携带 5 个标签。
4. 超过 5 个标签时分成后续批次，不能预先批量塞入 WorkTool 队列。
5. 提交后保存 `worktool_message_id`，等待指令回调。
6. 当前指令完成或超时后，才允许领取下一条。

这种单指令模式限制了标签同步最多只会在 WorkTool 队列中占据一个尚未完成的位置。

## 客户消息避让

本功能不建立全局优先级，也不改变旧发送流程。标签同步 worker 只执行单向避让：

1. 收到当前 Bot 的客户消息后，立即标记该 Bot 存在实时处理活动。
2. 标签 worker 不再领取新的 Outbox 记录。
3. 已提交给 WorkTool 的当前单条标签指令允许完成。
4. 原有消息合并、DClaw 调用、回复校验和 WorkTool 回复流程保持不变。
5. 客户回复提交到 WorkTool 后，实时活动结束。
6. 标签 worker 自动恢复并继续清空待同步记录。

该避让只控制新 worker，不改变 AI 回复、人工回复、客户激活、标签激活和主动推送之间原有的执行顺序。

## WorkTool 指令与结果

标签同步使用已验证的修改好友指令：

```json
{
  "socketType": 2,
  "list": [
    {
      "type": 213,
      "friend": {
        "name": "客户当前名称",
        "tagList": ["A类", "VIP"]
      }
    }
  ]
}
```

- 不传 `markName` 和 `markExtra`，避免修改客户备注及现有身份机制。
- HTTP 返回“指令已加入代发队列”只代表接收成功，不代表客户端执行成功。
- Outbox 必须等待 WorkTool 指令回调成功后才标记 `succeeded`。
- 回调通过 `worktool_message_id` 关联当前 processing 记录。

## 失败、重试与恢复

- Worker 使用事务原子领取记录并写入处理租约。
- 服务重启后，超过租约时间的 `processing` 记录恢复为可重试状态。
- 单次 run 内失败采用退避重试，最多尝试 3 次。
- 3 次仍失败后保留为 `failed`，写入 `last_error` 和下一次可重试时间。
- 下一次夜间 run 或管理员立即同步可以再次处理 `failed`。
- 找不到客户、Bot 离线、WorkTool 请求失败、指令回调失败和回调丢失都不能删除 Outbox。
- 重复提交同一标签是追加幂等操作，可以作为回调丢失后的安全恢复方式。
- 任意同步错误只记录在同步表与日志中，不更新现有消息处理失败状态，也不触发客户兜底回复。

## 管理员界面

在当前 Bot 的“配置”Tab 新增“企微标签同步”区域，仅 Bot 管理员可见：

- 启用企微标签同步开关。
- 维护开始时间。
- 维护结束时间。
- 待同步数量。
- 执行中数量。
- 失败数量。
- 最近一次执行时间和结果。
- 保存配置按钮。
- 立即同步按钮。

交互规则：

- 首次启用时提示会登记当前 Bot 全部私聊客户标签。
- 立即同步需要二次确认，说明该操作会占用当前 Bot 的 WorkTool 客户端队列。
- 运行中禁用重复启动，展示当前进度。
- 页面刷新后从服务端状态恢复展示，不依赖浏览器内存。
- 页面不提供删除企微标签、批量删除好友或白天周期性同步功能。

## API

建议新增 Bot 级管理员 API：

```text
GET  /api/bots/:botId/tag-sync/config
PUT  /api/bots/:botId/tag-sync/config
GET  /api/bots/:botId/tag-sync/status
POST /api/bots/:botId/tag-sync/run
```

- 所有接口复用现有 Bot 管理员访问校验。
- 普通 Bot 角色不能读取或修改同步配置，也不能启动立即同步。
- 保存配置时校验 `HH:mm`、时区和跨零点窗口。
- `POST .../run` 只启动或复用当前 Bot 的 manual run，不直接在 HTTP 请求中循环同步。

## 日志与可观测性

新增结构化日志事件：

```text
tag_sync.backfill.completed
tag_sync.run.started
tag_sync.run.paused
tag_sync.run.resumed
tag_sync.worker.claimed
tag_sync.command.submitted
tag_sync.command.succeeded
tag_sync.command.failed
tag_sync.lease.recovered
tag_sync.run.completed
```

日志必须包含 `botId`、`conversationKey`、`tagSyncRunId`、`outboxIds` 和 `worktoolMessageId` 中适用的字段，不输出 Bot 密码或管理员凭据。

## 测试策略

### 数据库测试

- 配置默认值、保存和跨零点窗口。
- 首次启用只补登记私聊客户标签，包含日期标签。
- Agent、人工和日期标签新增与 Outbox 同事务写入。
- 重复标签不产生重复 Outbox。
- 标签删除不产生企微删除任务。
- 原子领取、处理租约、超时恢复和重试。
- 服务重启场景下未完成记录仍可领取。

### Worker 测试

- 夜间窗口内启动，窗口外不启动。
- 窗口内新记录继续处理，窗口结束停止领取。
- 管理员立即同步不受时间窗口限制。
- 同一 Bot 单指令执行，多个 Bot 可并行。
- 标签超过 5 个时分批。
- 客户消息到达后暂停领取，回复提交后恢复。
- WorkTool 接收成功不提前标记成功。
- 指令回调成功、失败、丢失及迟到回调处理正确。

### 边界与回归测试

- 配置区只对管理员显示。
- API 拒绝普通 Bot 角色和跨 Bot 操作。
- 现有 AI 回复、人工回复、激活、标签激活和主动推送调用路径保持不变。
- 现有完整测试套件全部通过。

## 验收标准

- 启用某个 Bot 后，现有私聊客户标签全部进入持久化待同步记录。
- 夜间窗口或管理员立即同步能逐个客户追加企微标签。
- WorkTool 客户端实际执行成功后才减少待同步数量。
- 容器在执行中重启，未完成标签不丢失并可继续。
- 客户消息到达时最多等待当前一条标签指令，旧回复流程不被重构。
- 同步失败不会造成客户不回复、回复变慢到等待整个同步批次或内部标签丢失。
- 日期标签、普通标签和人工标签均能同步。
- 不修改客户备注名，不删除企微旧标签，不处理群聊标签。
