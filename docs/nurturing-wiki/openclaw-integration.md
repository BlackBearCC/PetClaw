# OpenClaw 深度集成

[← 返回首页](index.md)

## 核心命题：为什么是 OpenClaw + 养成

OpenClaw 是火热的开源 AI agent 平台——强大的工具调用、40+ 渠道、记忆系统、定时任务。但所有 AI 助手都面临同一个问题：**用完即走，没有留存**。用户对 AI 没有情感，换一个平台毫无成本。

宠物养成解决的正是这件事。区别在于：我们不是在 AI 助手旁边"贴"一个电子宠物，而是把 **AI 的真实能力具象化为宠物的成长**。

### 三层结合逻辑

**1. 能力即成长 — Agent 工具调用 = 宠物施展技能**

OpenClaw agent 调用 `web_search` / `code_execute` / `file_read` 不只是返回结果——它同时是宠物在"施展本领"。每次工具调用自动进入技能图鉴，积累领域 XP，推动宠物属性成长。

用户不需要额外操作。正常使用 AI → 宠物自然变强。**使用 AI 的过程就是养成的过程。**

```
用户让宠物搜资料 → web_search 调用 → "研究力" XP +1 → 图鉴 ★★☆
用户让宠物写代码 → code_execute   → "技术力" XP +1 → 图鉴 ★★★
用户让宠物画图   → image_gen      → "创意力" XP +1 → 图鉴 ★☆☆
                                        ↓
                              宠物：从什么都不会 → 全能小助手
                              用户：不是在"用工具"，是在"带它成长"
```

**2. 记忆即关系 — Memory 系统 = 宠物认识你**

OpenClaw 有 memory 系统（向量搜索 + FTS）。技术上是"知识库检索"，但包装在宠物人格里就是"它记得你"。

- 冷冰冰的 AI："根据历史记录，您之前提到过 React 项目。"
- 有记忆的宠物："诶，上次你说的那个 React 重构搞完了吗？我记得你卡在 Router 那块。"

同样的底层能力，完全不同的情感体验。记忆越多，宠物越"懂"你，关系越深，越舍不得换。

**3. 多渠道即陪伴 — Channel 系统 = 宠物跟着你**

OpenClaw 支持桌面、Discord、Slack、Telegram、Web...技术上是"多端同步"，产品上是"它一直在你身边"。

桌面上是你的桌宠，Discord 里是你的群聊伙伴，手机上是你的随身助手——同一个性格，同一段记忆，同一个等级。

### 竞争壁垒

| 维度 | 普通 AI 助手 | OpenClaw + 养成 |
|------|-------------|----------------|
| 切换成本 | 几乎为零 | Lv.25 的宠物、200 条记忆、技能图鉴——舍不得丢 |
| 留存动力 | 有需求才打开 | 不喂它会饿、有日常任务、想看它升级 |
| 功能探索 | 用户不知道有什么功能 | 技能图鉴未解锁 = 还有新技能可以教它 |
| 情感连接 | 无 | "我的宠物 Lv.25 了" 可以晒，可以比 |
| 付费意愿 | 付费 = 买能力（API quota） | 付费 = 给宠物买皮肤/食物/装饰（情感消费） |

---

## 现状

当前宠物系统与 OpenClaw 的集成点：

| 集成点 | 机制 | 位置 |
|--------|------|------|
| 状态注入 prompt | `agent:bootstrap` hook → PET_STATE.md | `pet.ts:220-242` |
| 聊天饥饿门控 | `getPetChatGate()` → chat.send 早期返回 | `chat.ts:1013-1025` |
| 消息计数 | `onMessage()` → ChatEvalSystem 意图评估 | `chat.ts:1023` |
| LLM 调用 | `petLLMComplete()` → 读 OpenClaw config 的 provider | `pet.ts:138-163` |
| 记忆索引 | `MemoryGraphSystem` → `getMemorySearchManager()` SQLite FTS | `pet.ts:186-202` |
| 文件持久化 | PersistenceStore → `resolveStateDir()` | `pet.ts:78-100` |

**未利用的 OpenClaw 能力:** Hook 系统（仅用 1/10+）、Cron 调度、Tools Catalog、Channel 系统、Session 系统。

---

## 一、已完成的集成

### 工具记录 + 领域推断 — 桌宠端已接通

桌宠客户端监听 `tool_event`，上报到服务端：

```
桌宠 app.js → tool_event → skillSystem.recordTool(toolName)  ← 本地图鉴
                          → petSync.recordTool(toolName)       ← pet.skill.tool RPC → 服务端引擎
```

领域推断同理：`pet.skill.record` RPC 已支持 `text` 参数，服务端 `inferDomainFromText()` 做关键词匹配。

**问题:** 只有桌宠端接了这条线。通过 Discord/Slack/Web/CLI 等其他渠道调用 agent 工具时，技能成长完全没有记录。

### 记忆提取 — 同样只有桌宠端触发

桌宠客户端在对话完成后调用 `pet.memory.extract` RPC。其他渠道的对话不会触发记忆提取。

---

## 二、`after-tool-call` Hook — 服务端统一记录

### 方案

在服务端注册 `after-tool-call` hook，所有渠道的工具调用自动记入技能系统：

```typescript
registerInternalHook("after-tool-call", (event) => {
  const { toolName } = event.context;
  const engine = getEngineIfReady();
  if (!engine) return;

  // 记录工具使用 → 技能图鉴星级
  engine.skills.recordTool(toolName);

  // 工具 → 领域映射
  const domain = TOOL_DOMAIN_MAP[toolName]; // web_search→研究, code_execute→编程, ...
  if (domain) {
    engine.skills.recordDomainActivity(domain, toolName, 1.0);
  }

  // 工具调用消耗 hunger
  engine.chatEval.onToolCall();
});
```

注册后桌宠端可以去掉 `petSync.recordTool()` 调用（本地图鉴 `skillSystem.recordTool()` 保留给 UI 即时更新）。

### 效果

```
桌宠用户调了 code_execute  → after-tool-call hook → 自动记录 ✓
Discord 用户调了 web_search → after-tool-call hook → 自动记录 ✓
CLI 用户调了 file_read      → after-tool-call hook → 自动记录 ✓
```

一处注册，全渠道覆盖。

---

## 三、`message-sent` Hook — 全渠道记忆提取

同理，记忆提取也应该在服务端 hook 统一触发：

#### `message-sent` — 回复完成自动触发记忆提取

```typescript
registerInternalHook("message-sent", (event) => {
  const { userMessage, assistantReply } = event.context;
  const engine = getEngineIfReady();
  if (!engine) return;

  engine.memoryGraph.enqueueExtraction(userMessage, assistantReply);
});
```

**效果:** 所有渠道的对话自动进入记忆图谱，不再依赖桌宠客户端调 `pet.memory.extract`。

---

## 四、记忆召回 — 已通过 memory_search 自动完成

### 现状：已打通

记忆召回**不需要额外实现**。OpenClaw 的 `memory_search` 工具已经覆盖了宠物记忆簇的检索。

完整数据流：

```
写入路径 (已实现):
  对话完成 → pet.memory.extract RPC → MemoryGraphSystem.enqueueExtraction()
    → LLM 提取簇 → indexClusters() → SQLite chunks + FTS (source='clusters')
    → 每个簇的 theme + keywords + implicitKeywords + summary + fragments 全部写入索引

召回路径 (OpenClaw 内建):
  用户提问 → agent 判断需要回忆 → 调用 memory_search(query)
    → manager.search() → BM25/hybrid 检索 → 命中 source='clusters' 的宠物记忆
    → 返回 snippet 给 LLM → LLM 结合记忆回复
```

### 为什么不需要 before-prompt-build hook

| 方案 | 问题 |
|------|------|
| ~~hook 每次注入 PET_MEMORY.md~~ | 每条消息都做 FTS 查询，无论是否需要；注入固定 3 条记忆可能不相关 |
| **memory_search 工具** (现有) | agent 自主判断何时需要回忆，按需检索，结果精准 |

`memory_search` 的 description 已经指导 agent 在涉及"prior work, decisions, preferences"时主动调用——这正是宠物记忆需要被召回的场景。

### 可优化方向

当前唯一的改进空间：在 PET_STATE.md 中追加一句提示，让 agent 更主动地使用记忆：

```typescript
// getPromptContext() 末尾追加
fragments.push("你可以用 memory_search 回忆和主人相关的事情，让对话更有连续感。");
```

这比自建召回系统更轻量，且复用 OpenClaw 已有基建。

---

## 五、Cron 调度 — 主动对话与定时任务

### 问题

P1 的"主动对话"和"每日任务刷新"需要定时触发。当前 PetEngine 用 `setInterval(1s)` tick loop 处理衰减，但主动对话、任务刷新等更适合用 OpenClaw 已有的 Cron 系统。

### 方案

复用 OpenClaw Cron（持久化、miss-fire 补偿、重启不丢失），注册宠物定时任务：

```typescript
// 在 getEngine() 初始化时注册
function registerPetCronJobs() {
  const cronService = getCronService();

  // 1. 每日任务刷新 — 每天 0:00
  cronService.addInternal({
    id: "pet:daily-reset",
    rule: "every day 0:00",
    handler: () => {
      engine.dailyTaskSystem.reset();
      engine.loginTracker.checkLogin();
    },
  });

  // 2. 主动对话检查 — 每 30 分钟
  cronService.addInternal({
    id: "pet:proactive-chat",
    rule: "every 30min",
    handler: () => {
      const state = engine.getFullState();
      const bubble = evaluateProactiveBubble(state);
      if (bubble) {
        broadcastToClients("pet:bubble", bubble);
      }
    },
  });

  // 3. 饥饿提醒 — 每小时检查
  cronService.addInternal({
    id: "pet:hunger-alert",
    rule: "every 1h",
    handler: () => {
      const hunger = engine.getAttribute("hunger");
      if (hunger.value <= 60) {
        broadcastToClients("pet:bubble", {
          type: "fixed",
          text: hunger.value <= 30 ? "太饿了...先喂喂我吧" : "有点饿了~",
        });
      }
    },
  });
}
```

### 主动对话判定

```typescript
function evaluateProactiveBubble(state: PetFullState): BubbleMessage | null {
  const now = Date.now();
  const idleMinutes = (now - state.lastInteractionTime) / 60000;

  // 长时间未交互
  if (idleMinutes > 30) {
    return {
      type: "fixed",
      text: randomPick(["你还在吗？", "好无聊...", "摸摸我嘛~"]),
      duration: 5000,
    };
  }

  // 心情低落
  if (state.mood < 30 && Math.random() < 0.3) {
    return {
      type: "fixed",
      text: randomPick(["有点难过...", "能陪我聊聊吗？"]),
      duration: 4000,
    };
  }

  return null; // 不触发
}
```

### 优势 vs 自建定时器

| 维度 | setInterval (现有) | OpenClaw Cron |
|------|-------------------|---------------|
| 重启后恢复 | 丢失 | 自动恢复 |
| Miss-fire 补偿 | 无 | 内建 |
| 持久化 | 无 | JSON 存储 |
| 可观测 | 无 | `cron.list` / `cron.runs` RPC |
| 精度 | 1s | 分钟级（足够） |

**属性衰减仍用 tick loop**（需要秒级精度），主动对话/任务刷新改用 Cron。

---

## 六、宠物 Tools — AI 自主操作

### 概念

在 OpenClaw 的 Tools Catalog 中注册**宠物专属工具**，让 AI 在对话中可以主动操作自己的状态。从"被动状态机"变成"自主决策体"。

### 工具定义

```typescript
const PET_TOOLS = [
  {
    name: "pet_self_care",
    description: "当你觉得自己需要休息、吃东西或调整状态时使用",
    parameters: {
      action: { type: "string", enum: ["feed", "rest", "play"] },
      reason: { type: "string", description: "为什么要这么做" },
    },
    handler: async ({ action, reason }) => {
      const result = engine.care.performAction(action);
      return `${reason}。${result.message}`;
    },
  },
  {
    name: "pet_remember",
    description: "主动记住用户提到的重要信息",
    parameters: {
      fact: { type: "string", description: "要记住的事实" },
      category: { type: "string", enum: ["preference", "project", "habit", "relationship"] },
    },
    handler: async ({ fact, category }) => {
      await engine.memoryGraph.addManualMemory(fact, category);
      return `已记住: ${fact}`;
    },
  },
  {
    name: "pet_express_mood",
    description: "表达当前的情绪状态，触发对应的动画",
    parameters: {
      emotion: { type: "string", enum: ["happy", "sad", "excited", "sleepy", "curious"] },
    },
    handler: async ({ emotion }) => {
      broadcastToClients("pet:animation", { name: emotion });
      return `*${EMOTION_TEXT[emotion]}*`;
    },
  },
];
```

### 交互示例

```
用户: "你今天怎么没精神啊"
AI 思考: mood=25, hunger=40, 确实状态不好
AI 调用: pet_self_care({ action: "feed", reason: "有点饿了" })
AI 调用: pet_express_mood({ emotion: "sleepy" })
AI 回复: "嗯...有点饿有点困...刚偷偷吃了点东西，好一点了（打哈欠）"

用户: "记住，我下周三有个重要答辩"
AI 调用: pet_remember({ fact: "主人下周三有重要答辩", category: "project" })
AI 回复: "记住啦！下周三答辩，到时候我提醒你~"
```

### 注入方式

```typescript
// agent:bootstrap hook 中追加工具描述
registerInternalHook("agent:bootstrap", (event) => {
  const ctx = event.context;
  // ... 现有 PET_STATE.md 注入 ...

  // 追加宠物工具到 TOOLS.md
  if (ctx.toolDefinitions) {
    ctx.toolDefinitions.push(...PET_TOOLS);
  }
});
```

### 安全约束

- 每轮对话最多调用 2 次宠物工具（防刷）
- `pet_self_care` 受 CareSystem 冷却限制
- `pet_remember` 受簇数量上限（50）限制
- 工具调用本身消耗 hunger（-1/次，复用现有逻辑）

---

## 七、Channel 维度 — 跨渠道人格

### 问题

OpenClaw 支持 40+ 渠道，宠物状态注入在 Gateway 层天然同步。但所有渠道共享同一套 prompt 片段——在 Discord 群聊中"撒娇"可能不合适。

### 方案：渠道维度微调

```typescript
// getPromptContext() 增加 channelType 参数
function getPromptContext(channelType?: string): string {
  const fragments = [...baseFragments]; // 现有 level + intimacy + mood/hunger/health

  // 渠道人格微调
  if (channelType) {
    const channelHint = CHANNEL_HINTS[channelType];
    if (channelHint) fragments.push(channelHint);
  }

  return fragments.join("\n");
}

const CHANNEL_HINTS: Record<string, string> = {
  "desktop-pet": "", // 桌宠端不加限制，最自然
  "discord":     "你现在在群聊中，说话简洁一些，不要太撒娇。",
  "slack":       "你现在在工作频道，保持专业但友好。",
  "telegram":    "你现在在私聊，可以随意一些。",
};
```

### 跨渠道经验汇总

所有渠道的活动统一汇入 PetEngine（已天然支持，因为 engine 是单例）：

```
Discord 用户调了 web_search  → after-tool-call hook → skillSystem.recordTool("web_search")
桌宠用户调了 code_execute    → after-tool-call hook → skillSystem.recordTool("code_execute")
Slack 用户聊了编程话题       → message-received hook → recordDomainActivity("技术")
                                    ↓
                            同一个 PetEngine 实例，经验自动汇总
```

---

## 八、Session 集成 — 会话上下文联动

### 会话主题 → 领域追踪

```typescript
registerInternalHook("session-end", (event) => {
  const { sessionKey, messageCount, duration } = event.context;
  const engine = getEngineIfReady();
  if (!engine) return;

  // 会话时长 → 日常任务 "今天聊了 N 分钟"
  engine.dailyTaskSystem.addProgress("chat_minutes", Math.floor(duration / 60000));

  // 会话消息数 → 经验值
  const baseExp = Math.min(messageCount * 2, 50); // 上限 50 EXP/会话
  engine.levelSystem.addExp(baseExp, "session_complete");
});
```

---

## 九、架构定位 — 为什么不做 Plugin 化

### 结论：PetEngine 是一等公民，不走 Plugin 体系

本项目是**独立商业产品**，宠物养成引擎是核心卖点，不是可选扩展。Plugin 体系是 OpenClaw 为第三方渠道/工具设计的（Discord 扩展、Notion 集成等），定位是"装了更好，卸了也行"。宠物引擎放进去定位就错了。

### Plugin 化的问题

| 维度 | 问题 |
|------|------|
| **产品定位** | Plugin = 可拆卸附件。宠物引擎是产品灵魂，卸载等于产品不存在 |
| **API 权限** | Plugin API 是给第三方的沙盒接口，hook 粒度和内部 API 访问都受限 |
| **演进自由度** | 需要改 OpenClaw 内部行为时（如 chat pipeline 深度集成），Plugin 做不到 |
| **调试成本** | Plugin 加载有自己的生命周期，出问题多一层排查 |
| **性能** | Plugin 走序列化 RPC 调用，不如直接 import 内部模块 |

### 当前架构的优势

```
src/pet/              ← 自有代码，完全控制
src/gateway/server-methods/pet.ts  ← 深度集成点，直接 import 内部模块
src/gateway/server-methods/chat.ts ← 改了 3 行，非侵入式
```

- **宠物代码独立目录** (`src/pet/`) — 与 OpenClaw 核心物理隔离，`git merge upstream/main` 零冲突
- **集成点最小化** — 只改 `pet.ts`（新文件）和 `chat.ts`（3 行 gate 检查），上游同步成本极低
- **Hook 无侵入注入** — `registerInternalHook` 是 OpenClaw 内部 API，比 Plugin manifest 更灵活
- **直接 import** — pet engine 可以 import OpenClaw 任何内部模块（config、memory、session），Plugin 做不到

### 上游同步策略

保持与 OpenClaw upstream 同步的关键不是 Plugin 化，而是**控制接触面**：

```
接触面清单 (需关注上游变更的文件):

  chat.ts          → 3 行 pet gate 检查 (getPetChatGate 调用)
  server-methods.ts → pet handlers 注册 (纯追加)

  完。其他全是新增文件，上游不会触碰。
```

同步流程：`git fetch upstream && git merge upstream/main` → 只需检查 `chat.ts` 是否有冲突 → 通常自动合并。

---

## 集成全景图

```
                        OpenClaw Gateway
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────┴─────┐     ┌──────┴──────┐     ┌──────┴──────┐
    │  Hook 系统  │     │  Cron 调度  │     │  Channel 层  │
    └─────┬─────┘     └──────┬──────┘     └──────┬──────┘
          │                  │                   │
  ┌───────┼────────┐    ┌────┼────┐         渠道人格微调
  │       │        │    │    │    │
after  before   msg  daily proactive  hunger
-tool  -prompt  -rcv reset  chat     alert
  │      │       │    │      │        │
  ▼      ▼       ▼    ▼      ▼        ▼
┌─────────────────────────────────────────────┐
│              PetEngine (单例)                │
│                                             │
│  SkillSystem ←── 工具自动记录 + 领域推断      │
│  MemoryGraph ←── 自动提取 + 对话时召回        │
│  ChatEval    ←── 意图评估                    │
│  CareSystem  ←── AI 自主调用宠物工具          │
│  DailyTask   ←── Cron 刷新                   │
│  LevelSystem ←── 会话完成 EXP                 │
│                                             │
│  getPromptContext(channelType?)              │
│    → PET_STATE.md (挡位片段)                  │
│    → PET_MEMORY.md (记忆召回)                 │
│    → PET_TOOLS (自主操作工具)                  │
└─────────────────────────────────────────────┘
```

---

## 实现优先级

### P0 — 服务端 Hook + 记忆提示

| # | 任务 | 改动范围 | 预估 |
|---|------|---------|------|
| 1 | `after-tool-call` hook 自动记录工具使用 + 领域映射 | `pet.ts` 新增 hook | 小 |
| 2 | `message-sent` hook 自动触发记忆提取 | `pet.ts` 新增 hook | 小 |
| 3 | PET_STATE.md 追加记忆提示语 | `pet-engine.ts` 一行 | 极小 |

完成后效果: 所有渠道的工具调用自动积累技能，对话自动进入记忆图谱，agent 主动召回宠物记忆。

### P1 — Cron 主动对话 + 领域推断

| # | 任务 | 改动范围 | 预估 |
|---|------|---------|------|
| 5 | Cron 注册宠物定时任务 | `pet.ts` + cron API | 中 |
| 6 | 主动对话气泡判定 + 广播 | `pet.ts` 新增函数 | 中 |
| 7 | `message-received` hook 领域关键词推断 | `pet.ts` 新增 hook | 小 |
| 8 | 渠道人格微调 | `pet-engine.ts` 改 getPromptContext | 小 |

### P2 — AI 自主体

| # | 任务 | 改动范围 | 预估 |
|---|------|---------|------|
| 9 | 宠物专属 Tools 注册 (pet_self_care / pet_remember / pet_express_mood) | `pet.ts` + 工具定义 | 中 |
| 10 | Session 集成（时长 EXP / 任务计数） | `pet.ts` 新增 hook | 小 |
