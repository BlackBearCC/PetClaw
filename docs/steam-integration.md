# PetClaw — Steam SDK 集成设计文档

> 基于实际代码结构设计。涉及文件路径均已对照 codebase 确认。

---

## 一、架构

### 设计原则

1. **不静默降级**：Steam 初始化失败要明确告知用户，显示错误原因和解决建议
2. **丰富体验**：
   - Steam 连接状态在 UI 可见（宠物状态栏）
   - 成就解锁有动画/提示/宠物庆祝
   - Rich Presence 要有意义（显示玩家在做什么）
3. **SDK 深度结合**：
   - 检查 Steam 是否运行
   - 检查用户是否登录
   - 成就系统完整接入（24个成就）
   - 统计数据同步
4. **好玩**：
   - 宠物可以"看到"玩家在玩什么 Steam 游戏
   - 根据游戏状态触发特殊对话
   - 成就解锁有宠物庆祝动画

### 数据流

```
Renderer (app.js)
  │  window.electronAPI.steamRPC(method, params)
  │  window.electronAPI.onSteamStatus(callback)
  │  window.electronAPI.onSteamAchievement(callback)
  │  window.electronAPI.onSteamGameChanged(callback)
  ▼
Preload (preload.js)
  │  ipcRenderer.invoke('steam-rpc', method, params)
  │  ipcRenderer.on('steam-status', ...)
  │  ipcRenderer.on('steam-achievement', ...)
  │  ipcRenderer.on('steam-game-changed', ...)
  ▼
Main (main.js)
  │  steamService.dispatch(method, params)
  │  steamService.setMainWindow(win)  // 用于发送事件
  │  mainWindow.webContents.send('steam-status', ...)
  ▼
electron/steam-service.js
  │  greenworks.*
  │  isSteamRunning(), isLoggedOn()
  │  状态轮询（每 5 秒）
  ▼
Steam Client（本机）
```

### 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron/steam-service.js` | 更新 | greenworks 封装，提供 `dispatch()`、状态检查、事件推送 |
| `src/SteamBridge.js` | 更新 | 渲染层单例，提供状态查询、事件回调、便捷方法 |
| `electron/preload.js` | 更新 | 暴露 `steamRPC` 和事件监听器 |
| `electron/main.js` | 更新 | 注册 IPC handler，初始化 steam-service，设置窗口引用 |
| `src/app.js` | 更新 | 创建 SteamBridge，接入成就/Rich Presence/Stats，游戏感知 |
| `src/ui/SteamStatusUI.js` | 新增 | Steam 连接状态 UI 组件 |
| `src/ui/AchievementCelebration.js` | 新增 | 成就解锁庆祝动画 |

---

## 二、steam-service.js 设计

```js
// electron/steam-service.js
class SteamService {
  constructor() {
    this._enabled = false;
    this._gw = null;
    this._initError = null;      // 初始化错误原因
    this._steamRunning = false;  // Steam 是否运行
    this._userLoggedIn = false;  // 用户是否登录
    this._mainWindow = null;     // 用于发送事件
    this._pollInterval = null;   // 状态轮询
  }

  setMainWindow(win) {
    this._mainWindow = win;
  }

  init() {
    // 1. 加载 greenworks
    // 2. 检查 Steam 是否运行（isSteamRunning）
    // 3. 初始化 API（initAPI）
    // 4. 检查用户是否登录（isLoggedOn）
    // 5. 启动状态轮询（每 5 秒检查运行/登录状态）
    // 返回 { ok, error?, details?, appId?, userLoggedIn? }
  }

  getStatus() {
    return {
      enabled: this._enabled,
      steamRunning: this._steamRunning,
      userLoggedIn: this._userLoggedIn,
      initError: this._initError,
      appId: this._enabled ? this._gw?.getAppId() : null,
    };
  }

  dispatch(method, params) {
    switch (method) {
      case 'getStatus': return this.getStatus();
      case 'activateAchievement': return this._activateAchievement(params.id, params.displayName);
      case 'setRichPresence': return this._setRichPresence(params.key, params.value);
      case 'clearRichPresence': return this._clearRichPresence();
      // ... 其他方法
    }
  }

  // 成就解锁时发送事件到渲染进程
  _emitAchievementUnlocked(id, displayName) {
    this._mainWindow?.webContents?.send('steam-achievement', { id, displayName, timestamp: Date.now() });
  }

  // 状态变化时发送事件
  _emitStatusChange() {
    this._mainWindow?.webContents?.send('steam-status', this.getStatus());
  }
}
```

### 关键改进

1. **明确的错误类型**：
   - `greenworks_not_installed` - greenworks 模块未安装
   - `steam_not_running` - Steam 客户端未运行
   - `init_failed` - SDK 初始化失败
   - `not_logged_in` - 用户未登录 Steam

2. **状态轮询**：每 5 秒检查 Steam 运行状态和用户登录状态，变化时自动通知渲染进程

3. **事件推送**：成就解锁、状态变化都通过 IPC 事件推送，无需轮询

---

## 三、SteamBridge.js 设计（渲染层）

```js
// src/SteamBridge.js
export class SteamBridge {
  constructor(electronAPI) {
    this._api = electronAPI;
    this._enabled = false;
    this._status = null;
    this._achievementCallbacks = [];
    this._statusCallbacks = [];
    this._gameCallbacks = [];
  }

  async init() {
    const status = await this._api.steamRPC('getStatus', {});
    this._status = status;
    this._enabled = status?.enabled === true;
    this._setupEventListeners();
    return { ok: this._enabled, ...status };
  }

  _setupEventListeners() {
    this._api.onSteamStatus?.((status) => {
      this._status = status;
      this._enabled = status?.enabled === true;
      this._statusCallbacks.forEach(cb => cb(status));
    });

    this._api.onSteamAchievement?.((data) => {
      this._achievementCallbacks.forEach(cb => cb(data));
    });

    this._api.onSteamGameChanged?.((game) => {
      this._gameCallbacks.forEach(cb => cb(game));
    });
  }

  // 便捷方法：设置当前状态
  async setStatus(state, context = {}) {
    const presenceMap = {
      idle: '#Status_Idle',
      chatting: '#Status_Chatting',
      working: '#Status_Working',
      learning: '#Status_Learning',
      exploring: '#Status_Exploring',
      playing: '#Status_Playing',
    };
    await this.setRichPresence('steam_display', presenceMap[state]);
    if (context.charName) await this.setRichPresence('char_name', context.charName);
    if (context.task) await this.setRichPresence('task', context.task);
  }

  // 注册回调
  onAchievementUnlocked(callback) { /* ... */ }
  onStatusChange(callback) { /* ... */ }
  onGameChanged(callback) { /* ... */ }
}
```

---

## 四、UI 组件

### SteamStatusUI

在宠物状态栏显示 Steam 连接状态：

- 🟢 已连接：绿色图标 + AppID
- ⚪ 未运行：灰色图标 + "Steam 未运行"
- 🟡 未登录：黄色图标 + "用户未登录"
- 🔴 错误：红色图标 + 错误提示

点击可显示详情对话框，包含：
- 当前状态详情
- 错误原因和解决建议（如果失败）
- Steam AppID、运行状态、登录状态

### AchievementCelebration

成就解锁时播放动画：

1. 触发宠物 happy 动画
2. 显示成就名称气泡
3. 飘落彩带/星星粒子
4. 弹出成就卡片

---

## 五、宠物游戏感知

宠物可以"看到"玩家在玩什么 Steam 游戏：

```js
// app.js
_handleSteamGameChanged(game) {
  if (!game) {
    // 玩家退出了游戏
    this._steam?.setStatus('idle');
    return;
  }
  
  // 根据游戏类型生成不同反应
  const gameName = game.name.toLowerCase();
  let reactions = [];
  
  if (/counter.?strike|csgo|valorant/i.test(gameName)) {
    reactions = ['在玩 FPS！加油射击！🎯', '爆头爆头！💥'];
  } else if (/minecraft|terraria|stardew/i.test(gameName)) {
    reactions = ['建造大师！🏠', '好想也建个猫窝~'];
  }
  // ... 更多游戏类型
  
  this.bubble.show(reactions[Math.floor(Math.random() * reactions.length)]);
  this.stateMachine.transition('happy');
}
```

---

## 六、成就系统

### 24 个成就映射

| 内部 ID | Steam API Name | 中文名 | 触发条件 |
|---------|---------------|--------|---------|
| first_tool | ACH_FIRST_TOOL | 初次工具 | 首次使用工具 |
| search_expert | ACH_SEARCH_EXPERT | 搜索专家 | 搜索 50 次 |
| code_craftsman | ACH_CODE_CRAFTSMAN | 代码工匠 | 代码相关 100 次 |
| terminal_master | ACH_TERMINAL_MASTER | 终端大师 | 终端命令 50 次 |
| all_rounder | ACH_ALL_ROUNDER | 全能助手 | 5 种工具各用 10 次 |
| soul_bond | ACH_SOUL_BOND | 心灵羁绊 | 亲密度满 |
| agent_commander | ACH_AGENT_COMMANDER | Agent 指挥官 | 子 Agent 100 次 |
| night_owl | ACH_NIGHT_OWL | 夜猫子 | 凌晨使用 |
| file_analyst | ACH_FILE_ANALYST | 文件分析师 | 文件分析 50 次 |
| chat_buddy | ACH_CHAT_BUDDY | 聊天伙伴 | 对话 500 次 |
| speed_runner | ACH_SPEED_RUNNER | 速通达人 | 快速完成 |
| web_surfer | ACH_WEB_SURFER | 冲浪高手 | Web 搜索 100 次 |
| first_chat | ACH_FIRST_CHAT | 第一次对话 | 首次对话完成 |
| mature_stage | ACH_MATURE_STAGE | 成熟伙伴 | 成长阶段 2 |
| veteran_stage | ACH_VETERAN_STAGE | 资深伙伴 | 成长阶段 3 |
| domain_master | ACH_DOMAIN_MASTER | 领域大师 | 单领域精通 |
| all_domains | ACH_ALL_DOMAINS | 全能领域 | 全领域探索 |
| adventure_complete | ACH_ADVENTURE_COMPLETE | 探险家 | 探险成功 |
| learning_finish | ACH_LEARNING_FINISH | 学习达人 | 完成学习 |
| memory_builder | ACH_MEMORY_BUILDER | 记忆构建者 | 记忆丰富 |
| daily_streak_7 | ACH_DAILY_STREAK_7 | 七日同行 | 连续 7 天 |
| daily_streak_30 | ACH_DAILY_STREAK_30 | 月月相伴 | 连续 30 天 |
| feed_100 | ACH_FEED_100 | 美食家 | 喂食 100 次 |
| full_wardrobe | ACH_FULL_WARDROBE | 换装达人 | 全装备 |

---

## 七、Rich Presence 状态

| 状态 | 显示文本 |
|------|---------|
| idle | 与猫咪悠闲待着 |
| chatting | 与猫咪深入交谈中 |
| working | 猫咪正在处理任务 |
| learning | 和猫咪一起学习中 |
| exploring | 猫咪出发探险了 |
| playing | 正在玩 [游戏名] |

---

## 八、统计数据

| Stat Name | 说明 |
|-----------|------|
| total_chat_count | 累计对话次数 |
| total_tool_uses | 累计工具使用次数 |
| intimacy_points | 当前亲密度 |
| days_played | 累计游玩天数 |
| adventure_count | 探险次数 |

---

## 九、实现清单

### Phase 1 — SDK 基础接入
- [x] `electron/steam-service.js` — 不静默降级，状态检查，事件推送
- [x] `src/SteamBridge.js` — 状态查询，事件回调，便捷方法
- [x] `electron/preload.js` — 暴露 API 和事件监听
- [x] `electron/main.js` — 初始化，设置窗口引用

### Phase 2 — UI 集成
- [x] `src/ui/SteamStatusUI.js` — 状态显示组件
- [x] `src/ui/AchievementCelebration.js` — 成就庆祝动画
- [x] `src/app.js` — 集成所有组件

### Phase 3 — 成就系统
- [x] 24 个成就映射
- [x] 成就解锁触发 Steam 成就
- [x] 成就解锁触发宠物庆祝动画

### Phase 4 — Rich Presence & Stats
- [x] Rich Presence 状态切换
- [x] 统计数据上报

### Phase 5 — 游戏感知
- [x] Steam 游戏变化回调
- [x] 根据游戏类型触发对话

---

## 十、注意事项

| 问题 | 说明 |
|------|------|
| greenworks 编译绑定 | 与 Electron 版本强绑定，升级 Electron 必须 `electron-rebuild` |
| 成就不可撤销 | Steam 成就解锁后无法重置，开发测试必须用单独 Steam 账号 |
| 渲染进程禁止加载 greenworks | 原生模块只能在主进程 require，渲染进程通过 IPC 访问 |
| API Key 绝不入 Steam Cloud | `petclaw.json` 必须在 Auto-Cloud 排除列表 |
| 非 Steam 启动兼容 | Steam 未运行时显示状态提示，不影响应用使用 |
| 状态变化通知 | Steam 关闭/重启会自动检测并更新 UI |