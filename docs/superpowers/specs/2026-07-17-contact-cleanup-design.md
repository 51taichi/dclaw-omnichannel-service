# 删除垃圾好友设计

## 目标

识别“对方已经删除我方企微员工，但 WorkTool/企微通讯录里仍占用额度”的联系人，并在确认无好友关系后调用 WorkTool 删除联系人接口清理。

## 结论

仅靠 WorkTool 推送回调不能判断对方是否删除我方。已经验证过目标“魔兮”被删除后的文本推送仍返回成功，`errorCode=0`、`successList=["魔兮"]`，所以删除判断必须引入企微官方外部联系人 API。

需求 1 可以实现，但前提是完成 `external_userid` 映射验证，并为每个机构配置企微自建应用的可信 IP、CorpID、Secret、员工 userid。需求 2 已通过 WorkTool 修改好友信息接口落地，可把收集到的姓名/手机号同步到备注。

## 方案

1. 管理员维护“企微配置卡片”：机构名称、CorpID、Secret、应用 AgentId、员工 userid、可信 IP 配置状态、清理策略。Secret 只保存密文或服务器侧环境变量引用，控制台不回显。
2. Bot 配置绑定一个 Agent，也可以绑定一个企微配置。只有绑定企微配置的 Bot 才允许启用垃圾好友清理。
3. 每天定时任务在低峰期运行，例如凌晨 3 点。每次按策略扫描一批联系人，限制最大删除人数，默认先 dry-run。
4. 清理逻辑先通过 WorkTool 好友列表或本地联系人表拿候选人，再用企微官方接口确认外部联系人和员工 userid 的 `follow_user` 关系。只有确认不存在好友关系时，才调用 WorkTool 删除联系人接口。
5. 每次运行都写审计日志：候选数量、确认仍有效数量、确认已删除数量、执行删除数量、失败原因、WorkTool 响应。

## 安全策略

- 默认 dry-run，不删除。
- 每晚设置 `maxDeletesPerRun`，避免一次误删大量联系人。
- 删除前必须有企微官方 API 的明确负向判断，不能用推送失败、昵称不存在、备注不匹配作为删除依据。
- 对 IP 白名单、权限不足、token 失败、接口限流等错误直接停止本轮任务，不进入删除阶段。
- 删除接口失败只记录失败，不重试到无限循环。

## 当前实现范围

本次先实现验证闭环，不做生产删除：

- `src/wecom.js`：企微 token、客户列表、客户详情 API 客户端与摘要函数。
- `scripts/verify-wecom-contact-mapping.js`：读取环境变量，验证某个员工 userid 能否获取 `external_userid` 列表，并检查客户详情中的 `follow_user` 是否包含该员工。
- `tests/wecom-client.test.js`：覆盖企微错误码、客户关系摘要和敏感值脱敏。

## 验证命令

在服务器设置环境变量后执行：

```bash
export WECOM_CORP_ID="企业ID"
export WECOM_APP_SECRET="自建应用Secret"
export WECOM_USER_ID="MoXi"
node scripts/verify-wecom-contact-mapping.js
```

如果已知道某个客户的 `external_userid`，可以指定：

```bash
export WECOM_EXTERNAL_USER_ID="wm_xxx"
node scripts/verify-wecom-contact-mapping.js
```

若返回 `errcode=60020`，说明当前服务器出口 IP 还没有加入企微自建应用可信 IP。
