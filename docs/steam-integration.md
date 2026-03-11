# PetClaw — Steam SDK 集成设计文档

## 一、架构概览

Steam SDK 通过 [greenworks](https://github.com/nicedoc/greenworks)（Node.js 原生绑定）接入 Electron 主进程，
客户端通过现有的单一 IPC 通道 `character-rpc` 扩展调用，**不新增 IPC 频道**。

```
Renderer (app.js / AchievementSystem.js)
  │  ipcRenderer.invoke('steam-rpc', method, params)
  ▼
Preload (preload.js)
  │  window.electronAPI.steamRPC(method, params)
  ▼
Main (steam-service.js)  ← 新增文件
  │  greenworks.* API
  ▼
Steam Client (本机)  ←─→  Steam Server
```

### 新增文件

```
apps/desktop-pet/electron/
└── steam-service.js       # greenworks 封装，暴露 steamRPC dispatcher

apps/desktop-pet/src/
└── SteamBridge.js         # 渲染层封装，供 app.js / AchievementSystem.js 调用
```

---

## 二、成就系统（重点）

### 2.1 服务端成就 → Steam 成就映射

现有 12 个成就（`achievement-system.ts`）直接对应 Steam 成就 ID：

| 内部 ID | Steam API Name | 中文名 | 条件 |
|---------|---------------|--------|------|
| `first_tool` | `ACH_FIRST_TOOL` | 初出茅庐 | 首次使用工具 |
| `search_expert` | `ACH_SEARCH_EXPERT` | 搜索达人 | 搜索类工具累计 20 次 |
| `code_craftsman` | `ACH_CODE_CRAFTSMAN` | 代码工匠 | 代码类工具累计 10 次 |
| `terminal_master` | `ACH_TERMINAL_MASTER` | 终端大师 | 终端类工具累计 10 次 |
| `all_rounder` | `ACH_ALL_ROUNDER` | 全能助手 | 解锁 10 种不同工具 |
| `soul_bond` | `ACH_SOUL_BOND` | 心灵契合 | 亲密度达到第 3 阶段 |
| `agent_commander` | `ACH_AGENT_COMMANDER` | 指挥官 | 同时拥有 3 只以上小分身 |
| `night_owl` | `ACH_NIGHT_OWL` | 夜猫子 | 深夜(0-4点)使用工具 |
| `file_analyst` | `ACH_FILE_ANALYST` | 文件侦探 | 拖放分析文件 5 次 |
| `chat_buddy` | `ACH_CHAT_BUDDY` | 话痨伙伴 | 完成 20 次对话 |
| `speed_runner` | `ACH_SPEED_RUNNER` | 神速执行 | 单会话工具 5 个以上 |
| `web_surfer` | `ACH_WEB_SURFER` | 冲浪高手 | 搜索类工具累计 10 次 |

### 2.2 扩展成就（PetClaw 特有，建议新增）

| Steam API Name | 中文名 | 条件 | 说明 |
|---------------|--------|------|------|
| `ACH_FIRST_CHAT` | 破冰 | 首次完成一次对话 | 引导新用户 |
| `ACH_MATURE_STAGE` | 成长记录 | 角色进入 mature 阶段 | 对应 GrowthSystem |
| `ACH_VETERAN_STAGE` | 老友相伴 | 角色进入 veteran 阶段 | 最高成长阶段 |
| `ACH_DOMAIN_MASTER` | 领域精通 | 任意领域 XP 达到 1000 | 7 个领域之一 |
| `ACH_ALL_DOMAINS` | 全域探索 | 全部 7 个领域有记录 | 多样化使用 |
| `ACH_ADVENTURE_COMPLETE` | 探险归来 | 完成首次探险 | AdventureSystem |
| `ACH_LEARNING_FINISH` | 学有所成 | 完成首个学习课程 | LearningSystem |
| `ACH_MEMORY_BUILDER` | 记忆编织者 | 记忆图谱达到 20 个簇 | MemoryGraphSystem |
| `ACH_DAILY_STREAK_7` | 七日同行 | 连续签到 7 天 | LoginTracker |
| `ACH_DAILY_STREAK_30` | 月月相伴 | 连续签到 30 天 | LoginTracker |
| `ACH_FEED_100` | 美食家 | 累计喂食 100 次 | CareSystem |
| `ACH_FULL_WARDROBE` | 全套装备 | 购买 10 件商店物品 | ShopSystem |

**总计：24 个成就**（Steam 建议 20-30 个，数量合适）

### 2.3 触发流程

```
服务端 AchievementSystem.check() 返回新解锁成就
  │
  ▼
character.ts RPC handler → _broadcast("character", { kind: "achievement", id, name })
  │
  ▼
app.js._handleAchievement(data)
  │
  ├── 播放解锁动画 + 气泡
  └── SteamBridge.unlockAchievement(steamId)
        │
        ▼
      steam-service.js → greenworks.activateAchievement(steamId, cb)
```

扩展成就的触发点：

| 成就 | 触发位置 |
|------|---------|
| `ACH_MATURE_STAGE` / `ACH_VETERAN_STAGE` | `CharacterStateSync.onGrowthStageUp()` |
| `ACH_DOMAIN_MASTER` / `ACH_ALL_DOMAINS` | `SkillPanel.js` 收到 skill 更新时检查 |
| `ACH_ADVENTURE_COMPLETE` | 探险结算通知回调 |
| `ACH_DAILY_STREAK_*` | 登录时 `CharacterStateSync` 同步 loginTracker 数据 |
| `ACH_MEMORY_BUILDER` | `MemoryGraphPanel.js` 收到 clusters 更新时检查 |

---

## 三、Rich Presence（正在干嘛）

在 Steamworks 后台 **Rich Presence Localization** 配置 key，代码只写 key 名：

### 状态设计

| 场景 | `steam_display` key | 显示文本（中文） |
|------|-------------------|----------------|
| 应用刚启动/空闲 | `#Status_Idle` | 与 {char_name} 悠闲地待着 |
| 用户在聊天中 | `#Status_Chatting` | 与 {char_name} 深入交谈中 |
| AI 工具执行中 | `#Status_Working` | {char_name} 正在帮忙处理任务 |
| 探险进行中 | `#Status_Adventure` | {char_name} 出发探险了 |
| 学习课程中 | `#Status_Learning` | 和 {char_name} 一起学习中 |
| 角色饥饿 | `#Status_Hungry` | {char_name} 饿了，快去喂食！ |
| 角色心情低落 | `#Status_Sad` | {char_name} 心情不好，需要陪伴 |
| 打开养成面板 | `#Status_Nurturing` | 查看 {char_name} 的成长记录 |

`{char_name}` 通过 `character.name` Rich Presence key 动态传入角色名。

### 代码示例

```js
// SteamBridge.js
setRichPresence(status, extra = {}) {
  window.electronAPI.steamRPC('setRichPresence', { status, ...extra });
}

// 触发点示例（app.js）
// 聊天开始时
this._steam.setRichPresence('#Status_Chatting');

// 探险开始时
this._steam.setRichPresence('#Status_Adventure');

// 饥饿时（CharacterStateSync.onAttributeChange 回调）
if (attr === 'hunger' && value < 30) {
  this._steam.setRichPresence('#Status_Hungry');
}
```

---

## 四、Steam Cloud 存档同步

### 同步文件列表

| 本地路径（相对 `~/.petclaw/store/character/`） | 说明 |
|----------------------------------------------|------|
| `mood.json` | 心情状态 |
| `hunger.json` | 饥饿状态 |
| `health.json` | 健康状态 |
| `intimacy.json` | 亲密度 / 成长点数 |
| `skill-system.json` | 领域数据、工具记录 |
| `achievement-system.json` | 成就解锁记录 |
| `learning-system.json` | 课程进度 |
| `memory-graph.json` | 记忆图谱簇 |

**不同步**：`CHARACTER_STATE.md`（运行时生成），LLM API Key（敏感信息）

### 在 Steamworks 后台配置

```
Steam Cloud → Auto-Cloud 配置
Root Path: {userdatapath}/{AppID}/remote/
File: character/*.json
Quota: 5 MB（足够）
```

### 冲突处理策略

优先使用**时间戳最新**的版本（Steam Cloud 默认策略），因为 PetClaw 数据是单设备累积型，不存在多端同时写入冲突。

---

## 五、Steam 统计数据（Stats）

用于排行榜和长期数据追踪，在 Steamworks 后台定义：

| Stat Name | 类型 | 说明 |
|-----------|------|------|
| `total_chat_count` | INT | 累计对话次数 |
| `total_tool_uses` | INT | 累计工具使用次数 |
| `intimacy_points` | INT | 当前亲密度总点数 |
| `days_played` | INT | 累计游玩天数 |
| `adventure_count` | INT | 探险次数 |

Stats 在每次角色状态同步时（10s polling）一并上报，无需单独触发。

---

## 六、实现步骤

### Phase 1 — SDK 基础接入（必做）

- [ ] `apps/desktop-pet` 安装 greenworks：`npm install greenworks`
- [ ] 用 `electron-rebuild` 重新编译原生模块
- [ ] 新建 `electron/steam-service.js`：初始化 greenworks，提供 `steamRPC` dispatcher
- [ ] `preload.js` 暴露 `window.electronAPI.steamRPC`
- [ ] `main.js` 注册 `ipcMain.handle('steam-rpc', ...)`
- [ ] 新建 `src/SteamBridge.js`：渲染层封装，export `unlockAchievement / setRichPresence / setStat`
- [ ] `app.js` 引入 SteamBridge，在 `_handleAchievement` 中调用

### Phase 2 — 成就完整覆盖

- [ ] Steamworks 后台录入全部 24 个成就（图标、描述、隐藏/公开）
- [ ] 扩展成就触发逻辑（LoginTracker streak、GrowthSystem stage、MemoryGraph count）
- [ ] 测试：用 AppID 480（Spacewar）验证 SDK 基础连通，再切换真实 AppID

### Phase 3 — Rich Presence & Stats

- [ ] Steamworks 后台配置 Rich Presence Localization（中英双语）
- [ ] 各状态触发点接入 `SteamBridge.setRichPresence()`
- [ ] Stats 上报接入 10s polling 回调

### Phase 4 — Steam Cloud

- [ ] Steamworks 后台配置 Auto-Cloud 路径
- [ ] 启动时检测云存档，提示用户是否同步

---

## 七、关键注意事项

1. **greenworks 需与 Electron 版本严格匹配**，升级 Electron 时必须重新 `electron-rebuild`
2. **SDK 初始化失败要静默降级**：`if (!greenworks.initAPI()) return;`，不能影响非 Steam 启动
3. **不要在渲染进程 require greenworks**，原生模块只能在主进程加载
4. **成就一旦解锁无法撤销**（Steam 机制），测试时用独立的测试账号
5. **LLM API Key 绝对不能进 Steam Cloud**，`~/.petclaw/` 下的配置文件要加排除规则
