# 普通对话与节点激活数据隔离设计

## 目标

普通客户消息调用 DClaw Agent 时，任务节点只提供目标、完成条件、收集字段和交流技巧，不提供 `activation` 配置。节点激活到期时，仍通过专用 `flow_activation_due` 请求提供本次参考话术。

## 边界

- 不修改状态机数据库结构和控制台配置。
- 不修改激活计时、次数、取消、重入和 Worker 逻辑。
- 普通请求中的 `flow.machine.nodes` 与 `flow.currentNode` 都移除 `activation`，避免 Agent 把激活话术当作正常节点话术。
- 专用激活请求继续携带任务快照中的参考话术，确保到期提醒正常工作。

## 验证

- 普通请求 JSON 和 metadata 中均不能出现节点 `activation`。
- 普通请求仍保留节点目标等业务字段。
- 专用激活请求仍包含 `flow_activation_due` 和本次激活参考话术。
