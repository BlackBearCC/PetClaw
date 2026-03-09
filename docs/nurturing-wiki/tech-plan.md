# 技术实现规划

[← 返回首页](index.md)

## 新增引擎模块

```
src/pet/
  ├── level-system.ts          # 等级系统 (EXP/升级/等级奖励)
  ├── care-system.ts           # 养护系统 (喂食/玩耍/休息/治疗 + 冷却)
  ├── daily-task-system.ts     # 每日任务 (档位/条件/奖励池/计数器)
  ├── chat-eval-system.ts      # 聊天评估 (消息计数/LLM 评估/clamp)
  ├── inventory-system.ts      # 背包系统 (道具管理/使用)
  ├── shop-system.ts           # 商城系统 (商品列表/购买/限购/星币)
  └── login-tracker.ts         # 登录追踪 (连续登录/在线时长)
```

## 修改现有模块

| 文件 | 改动 |
|------|------|
| `pet-engine.ts` | 组合新子系统; tick() 驱动被动恢复; chat 交互改为消耗 hunger |
| `attribute-engine.ts` | 新增等级系数接口，支持动态衰减倍率 |
| `presets.ts` | hunger max 300, initial 210, decayPerMinute 0.3; 离线上限 4h; 底线 60 |
| `growth-system.ts` | 新增 intimacy → EXP 联动事件 |
| `persona-engine.ts` | 根据等级注入更丰富的 prompt 片段 |

## 新增 RPC 方法

| 方法 | 功能 |
|------|------|
| `pet.level.info` | 获取等级、EXP、下一级进度 |
| `pet.care.feed` | 使用食物道具喂食(补充 token) |
| `pet.care.play` | 执行玩耍动作 |
| `pet.care.rest` | 开始休息 |
| `pet.care.heal` | 使用治疗道具 |
| `pet.chat.eval` | 触发聊天状态评估(内部，>=5min 间隔自动) |
| `pet.chat.canChat` | 检查是否有足够 hunger 聊天 |
| `pet.inventory.list` | 获取背包道具列表 |
| `pet.inventory.use` | 使用道具 |
| `pet.daily.tasks` | 获取今日任务列表(含 LLM 描述) |
| `pet.daily.claim` | 领取已完成任务奖励 |
| `pet.daily.streak` | 获取连续登录信息 |
| `pet.shop.list` | 获取商城商品列表(含价格/库存/限购) |
| `pet.shop.buy` | 购买商品(扣星币 + 检查限购 + 入背包) |
| `pet.wallet.info` | 获取星币余额和收支统计 |

## 聊天评估集成点

```
现有: 客户端 → chat.send → Gateway → LLM API → stream 回复

新增 (在 Gateway chat handler 中):

  1. chat.send 收到用户消息时:
     a. hunger <= 30 → 拒绝聊天，返回特殊状态码
     b. hunger -10
     c. engine.interact("chat") → mood +1
     d. 缓存消息摘要 + msgCount++

  1.5. 工具调用时: hunger -1

  2. 评估触发 (双条件):
     a. msgCount % 5 != 0 → 跳过
     b. 距上次评估 < 5min → 跳过
     c. 满足 → 异步 LLM 意图提取 → 查表 + streak → adjust

  3. hunger <= 30 时:
     chat.send 返回特殊状态码 + reason → 客户端显示"太饿了"气泡
```

## 每日任务 LLM 集成点

```
每日首次上线 / 跨日时:
  1. 后端生成 4 个任务骨架 { difficulty, condition, reward }
  2. 异步调用 LLM 生成 4 个 { name, desc }
  3. 组装完整任务列表，持久化
  4. LLM 失败 → fallback 名称/描述
```

## 数据持久化

新增 JSON 文件 (`~/.openclaw/store/pet/`):

```
level-system.json      — { exp, level, unlockedRewards }
inventory.json         — { items: [...], capacity }
daily-tasks.json       — { date, tasks, streak, lastLoginDate, counters }
chat-eval.json         — { msgCount, lastEvalAt, streak, lastDirection, recentMessages }
care-cooldowns.json    — { feed: timestamp, play: timestamp, ... }
wallet.json            — { coins, totalEarned, totalSpent }
shop-purchases.json    — { date, purchases: { itemId: count, ... } }
```
