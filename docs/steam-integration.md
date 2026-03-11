# PetClaw — Steam SDK 集成设计文档

> 基于实际代码结构设计。涉及文件路径均已对照 codebase 确认。

---

## 一、架构

### 数据流

```
Renderer (app.js)
  │  window.electronAPI.steamRPC(method, params)
  ▼
Preload (preload.js)                         ← 新增 steamRPC 暴露
  │  ipcRenderer.invoke('steam-rpc', method, params)
  ▼
Main (main.js)                               ← 新增 ipcMain.handle('steam-rpc', ...)
  │  steamService.dispatch(method, params)
  ▼
electron/steam-service.js  ← 新增文件        ← greenworks 封装层
  │  greenworks.*
  ▼
Steam Client（本机）
```

### 新增/改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `electron/steam-service.js` | 新增 | greenworks 封装，提供 `dispatch()` |
| `src/SteamBridge.js` | 新增 | 渲染层单例，供 `app.js` 调用 |
| `electron/preload.js` | 改动 | 暴露 `steamRPC` 方法 |
| `electron/main.js` | 改动 | 注册 `steam-rpc` IPC handler，初始化 steam-service |
| `src/app.js` | 改动 | 创建 SteamBridge，接入成就/Rich Presence/Stats 触发点 |

---

## 二、steam-service.js 设计

```js
// electron/steam-service.js
const path = require('path');
const { app } = require('electron');

class SteamService {
  constructor() {
    this._enabled = false;
    this._gw = null; // greenworks 实例
  }

  init() {
    try {
      // greenworks 只能在主进程 require，不可在渲染进程使用
      this._gw = require('greenworks');
      if (!this._gw.initAPI()) {
        console.warn('[steam] initAPI() returned false — Steam not running or no AppID');
        return false;
      }
      this._enabled = true;
      console.log('[steam] SDK initialized, AppID:', this._gw.getAppId());
      return true;
    } catch (e) {
      // greenworks 不存在（开发环境未安装）或 Steam 未启动 → 静默降级
      console.warn('[steam] SDK unavailable:', e.message);
      return false;
    }
  }

  dispatch(method, params = {}) {
    if (!this._enabled) return { ok: false, reason: 'disabled' };
    try {
      switch (method) {
        case 'activateAchievement':
          return this._activateAchievement(params.id);
        case 'setRichPresence':
          return this._setRichPresence(params.key, params.value ?? '');
        case 'setStatInt':
          return this._setStatInt(params.name, params.value);
        case 'storeStats':
          return this._storeStats();
        case 'isEnabled':
          return { ok: true, enabled: this._enabled };
        default:
          return { ok: false, reason: `unknown method: ${method}` };
      }
    } catch (e) {
      console.warn(`[steam] dispatch(${method}) error:`, e.message);
      return { ok: false, reason: e.message };
    }
  }

  _activateAchievement(id) {
    this._gw.activateAchievement(id, () => {
      console.log(`[steam] Achievement unlocked: ${id}`);
    });
    return { ok: true };
  }

  _setRichPresence(key, value) {
    this._gw.setRichPresence(key, value);
    return { ok: true };
  }

  _setStatInt(name, value) {
    this._gw.setStatInt(name, value);
    return { ok: true };
  }

  _storeStats() {
    this._gw.storeStats(() => {});
    return { ok: true };
  }

  shutdown() {
    if (this._enabled && this._gw) {
      try { this._gw.shutdown(); } catch {}
      this._enabled = false;
    }
  }
}

module.exports = { SteamService };
```

### main.js 改动

```js
// main.js — 在文件顶部 require 区
const { SteamService } = require('./steam-service');

// 在 app.whenReady() 内，createWindow() 之前
const steamService = new SteamService();
steamService.init(); // 失败静默降级，不影响启动

// 注册 IPC handler（与 character-rpc 写法完全一致）
ipcMain.handle('steam-rpc', async (event, method, params) => {
  return steamService.dispatch(method, params);
});

// app.on('before-quit') 内补充：
if (steamService) { steamService.shutdown(); }
```

### preload.js 改动

在 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 末尾追加一行：

```js
// === Steam SDK ===
steamRPC: (method, params) => ipcRenderer.invoke('steam-rpc', method, params),
```

---

## 三、SteamBridge.js 设计（渲染层）

```js
// src/SteamBridge.js
// 渲染进程 Steam 封装。plain ES module，无 bundler。

// 内部 ID → Steam API Name 映射
const ACH_MAP = {
  // 现有 12 个（对应 achievement-system.ts / AchievementSystem.js）
  first_tool:       'ACH_FIRST_TOOL',
  search_expert:    'ACH_SEARCH_EXPERT',
  code_craftsman:   'ACH_CODE_CRAFTSMAN',
  terminal_master:  'ACH_TERMINAL_MASTER',
  all_rounder:      'ACH_ALL_ROUNDER',
  soul_bond:        'ACH_SOUL_BOND',
  agent_commander:  'ACH_AGENT_COMMANDER',
  night_owl:        'ACH_NIGHT_OWL',
  file_analyst:     'ACH_FILE_ANALYST',
  chat_buddy:       'ACH_CHAT_BUDDY',
  speed_runner:     'ACH_SPEED_RUNNER',
  web_surfer:       'ACH_WEB_SURFER',
  // 扩展 12 个（见第四章）
  first_chat:         'ACH_FIRST_CHAT',
  mature_stage:       'ACH_MATURE_STAGE',
  veteran_stage:      'ACH_VETERAN_STAGE',
  domain_master:      'ACH_DOMAIN_MASTER',
  all_domains:        'ACH_ALL_DOMAINS',
  adventure_complete: 'ACH_ADVENTURE_COMPLETE',
  learning_finish:    'ACH_LEARNING_FINISH',
  memory_builder:     'ACH_MEMORY_BUILDER',
  daily_streak_7:     'ACH_DAILY_STREAK_7',
  daily_streak_30:    'ACH_DAILY_STREAK_30',
  feed_100:           'ACH_FEED_100',
  full_wardrobe:      'ACH_FULL_WARDROBE',
};

export class SteamBridge {
  constructor(electronAPI) {
    this._api = electronAPI;
    this._enabled = false;
    this._statBuffer = {}; // 缓冲 stat，延迟 storeStats
    this._storeTimer = null;
  }

  async init() {
    const res = await this._api.steamRPC('isEnabled', {}).catch(() => null);
    this._enabled = res?.enabled === true;
    console.log('[steam-bridge] enabled:', this._enabled);
  }

  /** 解锁成就。传入内部 ID（如 'first_tool'）或 Steam API Name（如 'ACH_FIRST_TOOL'） */
  unlockAchievement(id) {
    if (!this._enabled) return;
    const steamId = ACH_MAP[id] ?? id; // 未在 map 中则原样传入
    this._api.steamRPC('activateAchievement', { id: steamId });
  }

  /** 设置 Rich Presence。key 为 Steamworks 后台配置的 key 名 */
  setRichPresence(key, value = '') {
    if (!this._enabled) return;
    this._api.steamRPC('setRichPresence', { key, value });
  }

  /** 上报 int 型统计数据（自动批量 storeStats，5s 内去抖） */
  reportStat(name, value) {
    if (!this._enabled) return;
    this._statBuffer[name] = value;
    if (this._storeTimer) clearTimeout(this._storeTimer);
    this._storeTimer = setTimeout(() => this._flushStats(), 5000);
  }

  _flushStats() {
    for (const [name, value] of Object.entries(this._statBuffer)) {
      this._api.steamRPC('setStatInt', { name, value });
    }
    this._statBuffer = {};
    this._api.steamRPC('storeStats', {});
    this._storeTimer = null;
  }
}
```

---

## 四、成就系统

### 4.1 现有 12 个成就的接入方式

客户端 `AchievementSystem.js` 已有 `onUnlock(cb)` 回调（[src/character/AchievementSystem.js:83](../apps/desktop-pet/src/character/AchievementSystem.js#L83)）。

在 `app.js` 现有的 `onUnlock` 注册块追加 Steam 调用：

```js
// app.js ≈ line 411（现有代码处追加最后一行）
this.achievementSystem.onUnlock((ach) => {
  this.bubble.show(`🏆 成就解锁：${ach.name}！${ach.icon}`, 4000);
  this.stateMachine.transition('happy', { force: true, duration: 3000 });
  if (ach.intimacyBonus > 0) this.charSync.interact('achievement', { intimacy: ach.intimacyBonus });
  this._steam?.unlockAchievement(ach.id);   // ← 新增
});
```

### 4.2 扩展 12 个成就

| Steam API Name | 中文名 | 触发位置 | 触发条件 |
|---------------|--------|---------|---------|
| `ACH_FIRST_CHAT` | 破冰 | `app.js` chat 完成块（≈ line 913） | `_chatCompletionCount === 1` |
| `ACH_MATURE_STAGE` | 成长记录 | `charSync.onGrowthStageUp` 回调 | `stage >= 2`（intimate） |
| `ACH_VETERAN_STAGE` | 老友相伴 | `charSync.onGrowthStageUp` 回调 | `stage >= 3`（bonded） |
| `ACH_DOMAIN_MASTER` | 领域精通 | `skillSystem.onUnlock` 回调后 | 任意属性 XP ≥ 1000 |
| `ACH_ALL_DOMAINS` | 全域探索 | `skillSystem.onUnlock` 回调后 | 全部 7 领域有记录 |
| `ACH_ADVENTURE_COMPLETE` | 探险归来 | `_handleAdventureCompleted()`（≈ line 1095） | `success === true` 且首次 |
| `ACH_LEARNING_FINISH` | 学有所成 | LearningSystem 课程完成回调 | 首次完成课程 |
| `ACH_MEMORY_BUILDER` | 记忆编织者 | `MemoryGraphPanel` 数据刷新后 | clusters.length ≥ 20 |
| `ACH_DAILY_STREAK_7` | 七日同行 | charSync 连接后查 loginTracker | streak ≥ 7 |
| `ACH_DAILY_STREAK_30` | 月月相伴 | charSync 连接后查 loginTracker | streak ≥ 30 |
| `ACH_FEED_100` | 美食家 | `charSync.interact('feed')` 完成后 | 累计喂食 ≥ 100 |
| `ACH_FULL_WARDROBE` | 全套装备 | 商店购买成功回调 | 累计购买 ≥ 10 件 |

**总计：24 个成就**（Steam 建议 20–30 个，合适）

### 4.3 扩展成就的接入代码示例

```js
// app.js — charSync 初始化完成后注册

// 成长阶段
this.charSync.onGrowthStageUp((stage, stageName) => {
  if (stage >= 2) this._steam?.unlockAchievement('mature_stage');
  if (stage >= 3) this._steam?.unlockAchievement('veteran_stage');
});

// 探险成功（首次）
// _handleAdventureCompleted() 内已有 success 判断，追加：
if (success && !localStorage.getItem('ach-adventure-done')) {
  localStorage.setItem('ach-adventure-done', '1');
  this._steam?.unlockAchievement('adventure_complete');
}

// daily streak — charSync 连接后
const loginInfo = await this._api.characterRPC('character.daily.tasks');
const streak = loginInfo?.loginStreak ?? 0;
if (streak >= 7)  this._steam?.unlockAchievement('daily_streak_7');
if (streak >= 30) this._steam?.unlockAchievement('daily_streak_30');
```

---

## 五、Rich Presence

### Steamworks 后台配置（Rich Presence Localization）

```
# 中文
Status_Idle       = 与{#char_name}悠闲待着
Status_Chatting   = 与{#char_name}深入交谈中
Status_Working    = {#char_name}正在处理任务
Status_Adventure  = {#char_name}出发探险了
Status_Learning   = 和{#char_name}一起学习中
Status_Hungry     = {#char_name}饿了，快去喂食！
Status_Sad        = {#char_name}心情不好，需要陪伴

# 英文（必须同时提供）
Status_Idle       = Relaxing with {#char_name}
Status_Chatting   = Deep in conversation with {#char_name}
Status_Working    = {#char_name} is handling a task
Status_Adventure  = {#char_name} is out exploring
Status_Learning   = Studying with {#char_name}
Status_Hungry     = {#char_name} is hungry!
Status_Sad        = {#char_name} needs some company
```

`{#char_name}` 对应的 Rich Presence key 名为 `char_name`，由代码单独 set。

### 触发点（app.js）

```js
// 初始化完成后
this._steam?.setRichPresence('steam_display', '#Status_Idle');
this._steam?.setRichPresence('char_name', '猫咪');  // 从 config 读角色名

// 聊天开始（chatPanel.open 时）
this._steam?.setRichPresence('steam_display', '#Status_Chatting');

// 聊天结束
this._steam?.setRichPresence('steam_display', '#Status_Idle');

// 探险开始（NurturingPanel 发起探险后）
this._steam?.setRichPresence('steam_display', '#Status_Adventure');

// 饥饿（charSync.onAttributeChange 回调）
this.charSync.onAttributeChange((key, level) => {
  if (key === 'hunger' && level === 'starving') {
    this._steam?.setRichPresence('steam_display', '#Status_Hungry');
  }
});
```

---

## 六、Steam Stats（统计）

Stats 是成就的数值基础，也用于排行榜（未来）。在 Steamworks 后台定义为 INT 类型。

| Stat Name | 说明 | 上报时机 |
|-----------|------|---------|
| `total_chat_count` | 累计对话次数 | chat 完成时 |
| `total_tool_uses` | 累计工具使用次数 | agent 事件 `tool:use` 时 |
| `intimacy_points` | 当前亲密度总点数 | 10s polling 后 |
| `days_played` | 累计游玩天数 | charSync 连接后 |
| `adventure_count` | 探险次数 | 探险完成时 |

```js
// app.js — charSync polling 回调后
this._steam?.reportStat('intimacy_points', this.charSync.getGrowthPoints());

// chat 完成时
this._steam?.reportStat('total_chat_count', this._chatCompletionCount);
```

`reportStat` 内部已做 5s 去抖，多次调用只触发一次 `storeStats`。

---

## 七、Steam Cloud 存档同步

### 需要同步的文件

`~/.petclaw/store/character/` 下的 JSON 文件：

```
mood.json, hunger.json, health.json, intimacy.json
skill-system.json, achievement-system.json
learning-system.json, memory-graph.json
```

### Steamworks 后台配置（Auto-Cloud）

```
Root Path:  {userdata}/{AppID}/remote/character/
Files:      *.json
OS:         Windows
Quota:      5 MB
```

由于 `~/.petclaw/` 不在 Steam 默认路径内，需要在应用启动时将 character 状态目录**软链**到 Steam remote 路径，或在 `steam-service.js` 启动时做一次文件复制同步。

**推荐方案**：维持原有存储路径不变，在 `SteamService.init()` 后读取 Steam remote 路径，比较 `updatedAt` 时间戳，选择较新的文件覆盖本地 — 仅在首次启动/换设备时执行一次。

### 不同步的文件

- `CHARACTER_STATE.md` — 运行时动态生成
- `petclaw.json` — 包含 LLM API Key，**绝对不同步**
- `identity/device.json` — 设备身份，不应在设备间共享

---

## 八、Steam Overlay

greenworks 初始化成功后，Steam Overlay（Shift+Tab）自动可用，无需额外代码。

但 Electron 透明窗口会导致 Overlay 渲染异常（透明区域黑屏）。解决方案：

- 创建一个**不可见的普通 BrowserWindow**（`transparent: false`, `show: false`）专门用于承载 Overlay，不影响宠物窗口
- 或在 `main.js` 中调用 `mainWindow.setContentProtection(false)` 并测试 Overlay 表现

---

## 九、实现步骤

### Phase 1 — SDK 基础接入

```bash
cd apps/desktop-pet
npm install greenworks
npx electron-rebuild -f -w greenworks
```

- [ ] 新建 `electron/steam-service.js`（见第二章）
- [ ] `electron/main.js` 引入 SteamService，注册 `steam-rpc` IPC
- [ ] `electron/preload.js` 追加 `steamRPC` 暴露
- [ ] 新建 `src/SteamBridge.js`（见第三章）
- [ ] `src/app.js` 在构造函数加 `this._steam = null`，`init()` 阶段 `new SteamBridge(...).init()`

测试：在 `apps/desktop-pet/` 根目录放 `steam_appid.txt`（内容为 AppID），启动后 Steam 显示"正在游玩"即成功。

### Phase 2 — 成就系统完整覆盖

- [ ] Steamworks 后台录入全部 24 个成就（API Name / 图标 / 描述 / 隐藏与否）
- [ ] `app.js` 追加 `onUnlock` Steam 回调（第四章 4.1）
- [ ] `app.js` 注册扩展成就触发逻辑（第四章 4.3）
- [ ] 用测试账号验证全部成就触发（成就解锁后无法清除，必须用独立测试账号）

### Phase 3 — Rich Presence & Stats

- [ ] Steamworks 后台配置 Rich Presence Localization（中英双语）
- [ ] `app.js` 各触发点接入 `setRichPresence()`
- [ ] Stats 上报接入

### Phase 4 — Steam Cloud

- [ ] Steamworks 后台配置 Auto-Cloud
- [ ] `steam-service.js` 启动时实现云存档同步逻辑

---

## 十、注意事项

| 问题 | 说明 |
|------|------|
| greenworks 编译绑定 | 与 Electron 版本强绑定，升级 Electron 必须 `electron-rebuild` |
| SDK init 失败静默降级 | `init()` 返回 false → `_enabled = false` → 所有调用变 no-op |
| 成就不可撤销 | Steam 成就解锁后无法重置，开发测试必须用单独 Steam 账号 |
| 渲染进程禁止加载 greenworks | 原生模块只能在主进程 require，渲染进程通过 IPC 访问 |
| API Key 绝不入 Steam Cloud | `petclaw.json` 必须在 Auto-Cloud 排除列表 |
| 非 Steam 启动兼容 | 直接双击 exe 启动时 Steam Client 未运行，init 失败，功能静默关闭，不影响使用 |
