/**
 * SteamBridge.js — 渲染层 Steam 封装
 *
 * 设计原则：
 * - 不静默失败：错误要传播给调用方处理
 * - 状态可查询：UI 可以获取 Steam 连接状态
 * - 事件驱动：成就解锁触发回调
 *
 * 使用方式：
 *   const steam = new SteamBridge(electronAPI);
 *   const result = await steam.init();
 *   if (!result.ok) {
 *     // 显示错误给用户
 *     showSteamError(result.details);
 *   }
 *   steam.onAchievementUnlocked((data) => {
 *     // 播放宠物庆祝动画
 *     pet.celebrate(data);
 *   });
 *   steam.unlockAchievement('first_tool');
 *   steam.setRichPresence('steam_display', '#Status_Chatting');
 */

// 内部 ID → Steam API Name 映射
// 共 24 个成就
const ACH_MAP = {
  // 基础 12 个成就（对应 AchievementSystem.js）
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
  // 扩展 12 个成就（养成系统相关）
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

// 成就显示名称（用于 UI）
const ACH_DISPLAY_NAMES = {
  first_tool:       '初次工具',
  search_expert:    '搜索专家',
  code_craftsman:   '代码工匠',
  terminal_master:  '终端大师',
  all_rounder:      '全能助手',
  soul_bond:        '心灵羁绊',
  agent_commander:  'Agent 指挥官',
  night_owl:        '夜猫子',
  file_analyst:     '文件分析师',
  chat_buddy:       '聊天伙伴',
  speed_runner:     '速通达人',
  web_surfer:       '冲浪高手',
  first_chat:       '第一次对话',
  mature_stage:     '成熟伙伴',
  veteran_stage:    '资深伙伴',
  domain_master:    '领域大师',
  all_domains:      '全能领域',
  adventure_complete: '探险家',
  learning_finish:  '学习达人',
  memory_builder:   '记忆构建者',
  daily_streak_7:   '连续打卡 7 天',
  daily_streak_30:  '连续打卡 30 天',
  feed_100:         '喂食达人',
  full_wardrobe:    '换装达人',
};

// Rich Presence 状态常量
const RICH_PRESENCE = {
  IDLE: '#Status_Idle',
  CHATTING: '#Status_Chatting',
  WORKING: '#Status_Working',
  LEARNING: '#Status_Learning',
  EXPLORING: '#Status_Exploring',
  PLAYING: '#Status_Playing',
};

export class SteamBridge {
  /**
   * @param {object} electronAPI preload 暴露的 API
   */
  constructor(electronAPI) {
    this._api = electronAPI;
    this._enabled = false;
    this._status = null; // { enabled, steamRunning, userLoggedIn, initError, ... }
    this._statBuffer = {};      // 缓冲 stat，延迟 storeStats
    this._storeTimer = null;    // 去抖定时器
    this._achievementCallbacks = []; // 成就解锁回调
    this._statusCallbacks = []; // 状态变化回调
    this._gameCallbacks = [];   // 游戏变化回调
    this._initResult = null;    // 初始化结果缓存
  }

  /**
   * 初始化，检测 Steam SDK 是否可用
   * @returns {Promise<{ok: boolean, error?: string, details?: string, ...}>}
   */
  async init() {
    if (!this._api?.steamRPC) {
      this._status = {
        enabled: false,
        steamRunning: false,
        userLoggedIn: false,
        initError: 'api_unavailable',
        initErrorDetails: 'Steam API 不可用（可能是预加载脚本未正确加载）'
      };
      this._initResult = { ok: false, ...this._status };
      console.warn('[steam-bridge] steamRPC 不可用');
      return this._initResult;
    }

    try {
      // 获取状态
      const status = await this._api.steamRPC('getStatus', {});
      this._status = status;
      this._enabled = status?.enabled === true;

      if (this._enabled) {
        console.log('[steam-bridge] ✅ Steam 已连接，AppID:', status.appId);

        // 注册事件监听
        this._setupEventListeners();

        // 初始化 Rich Presence
        await this._api.steamRPC('setRichPresence', {
          key: 'steam_display',
          value: RICH_PRESENCE.IDLE
        });
      } else {
        console.warn('[steam-bridge] ❌ Steam 未启用:', status.initError);
      }

      this._initResult = {
        ok: this._enabled,
        error: status.initError,
        details: status.initErrorDetails,
        appId: status.appId,
        steamRunning: status.steamRunning,
        userLoggedIn: status.userLoggedIn,
      };
      return this._initResult;
    } catch (e) {
      console.error('[steam-bridge] init 异常:', e.message);
      this._status = {
        enabled: false,
        steamRunning: false,
        userLoggedIn: false,
        initError: 'exception',
        initErrorDetails: e.message
      };
      this._initResult = { ok: false, error: 'exception', details: e.message };
      return this._initResult;
    }
  }

  /**
   * 设置事件监听
   */
  _setupEventListeners() {
    // 监听状态变化
    this._api.onSteamStatus?.((status) => {
      const wasEnabled = this._enabled;
      this._status = status;
      this._enabled = status?.enabled === true;

      if (wasEnabled !== this._enabled) {
        console.log(`[steam-bridge] 状态变化: ${wasEnabled ? '已连接' : '已断开'} → ${this._enabled ? '已连接' : '已断开'}`);
        this._statusCallbacks.forEach(cb => {
          try { cb(status); } catch (e) { console.error('[steam-bridge] status callback error:', e); }
        });
      }
    });

    // 监听成就解锁
    this._api.onSteamAchievement?.((data) => {
      console.log('[steam-bridge] 🏆 成就解锁事件:', data.id);
      this._achievementCallbacks.forEach(cb => {
        try { cb(data); } catch (e) { console.error('[steam-bridge] achievement callback error:', e); }
      });
    });

    // 监听游戏变化（玩家开始/退出游戏）
    this._api.onSteamGameChanged?.((game) => {
      console.log('[steam-bridge] 游戏状态变化:', game);
      this._gameCallbacks.forEach(cb => {
        try { cb(game); } catch (e) { console.error('[steam-bridge] game callback error:', e); }
      });
    });
  }

  /**
   * 是否已启用
   */
  get isEnabled() {
    return this._enabled;
  }

  /**
   * 获取当前状态
   */
  get status() {
    return this._status;
  }

  /**
   * 获取初始化结果（用于 UI 显示错误）
   */
  get initResult() {
    return this._initResult;
  }

  /**
   * 注册状态变化回调
   * @param {(status: object) => void} callback
   */
  onStatusChange(callback) {
    this._statusCallbacks.push(callback);
    return () => {
      const idx = this._statusCallbacks.indexOf(callback);
      if (idx >= 0) this._statusCallbacks.splice(idx, 1);
    };
  }

  /**
   * 注册成就解锁回调
   * @param {(data: {id: string, displayName: string, timestamp: number}) => void} callback
   */
  onAchievementUnlocked(callback) {
    this._achievementCallbacks.push(callback);
    return () => {
      const idx = this._achievementCallbacks.indexOf(callback);
      if (idx >= 0) this._achievementCallbacks.splice(idx, 1);
    };
  }

  /**
   * 注册游戏状态变化回调
   * @param {(game: {appId: number, name: string} | null) => void} callback
   */
  onGameChanged(callback) {
    this._gameCallbacks.push(callback);
    return () => {
      const idx = this._gameCallbacks.indexOf(callback);
      if (idx >= 0) this._gameCallbacks.splice(idx, 1);
    };
  }

  /**
   * 解锁成就
   * @param {string} id 内部成就 ID（如 'first_tool'）或 Steam API Name（如 'ACH_FIRST_TOOL'）
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async unlockAchievement(id) {
    if (!this._enabled || !id) {
      return { ok: false, reason: this._enabled ? 'missing_id' : 'disabled' };
    }

    const steamId = ACH_MAP[id] ?? id; // 未在 map 中则原样传入
    const displayName = ACH_DISPLAY_NAMES[id] || steamId;

    try {
      const result = await this._api.steamRPC('activateAchievement', {
        id: steamId,
        displayName
      });

      if (result.ok) {
        console.log(`[steam-bridge] 成就解锁成功: ${displayName}`);
      } else {
        console.warn(`[steam-bridge] 成就解锁失败 (${displayName}):`, result.reason);
      }

      return result;
    } catch (e) {
      console.error(`[steam-bridge] 成就解锁异常 (${displayName}):`, e.message);
      return { ok: false, reason: e.message };
    }
  }

  /**
   * 设置 Rich Presence
   * @param {string} key Steamworks 后台配置的 key 名
   * @param {string} value 值
   * @returns {Promise<{ok: boolean}>}
   */
  async setRichPresence(key, value = '') {
    if (!this._enabled || !key) return { ok: false };
    try {
      return await this._api.steamRPC('setRichPresence', { key, value });
    } catch (e) {
      console.error('[steam-bridge] setRichPresence 异常:', e.message);
      return { ok: false, reason: e.message };
    }
  }

  /**
   * 设置当前状态（便捷方法）
   * @param {'idle' | 'chatting' | 'working' | 'learning' | 'exploring' | 'playing'} state
   * @param {object} context 附加上下文
   */
  async setStatus(state, context = {}) {
    const presenceMap = {
      idle: RICH_PRESENCE.IDLE,
      chatting: RICH_PRESENCE.CHATTING,
      working: RICH_PRESENCE.WORKING,
      learning: RICH_PRESENCE.LEARNING,
      exploring: RICH_PRESENCE.EXPLORING,
      playing: RICH_PRESENCE.PLAYING,
    };

    const presence = presenceMap[state] || RICH_PRESENCE.IDLE;
    await this.setRichPresence('steam_display', presence);

    // 设置附加上下文
    if (context.task) {
      await this.setRichPresence('task', context.task);
    }
    if (context.charName) {
      await this.setRichPresence('char_name', context.charName);
    }
  }

  /**
   * 清除 Rich Presence
   */
  async clearRichPresence() {
    if (!this._enabled) return { ok: false };
    try {
      return await this._api.steamRPC('clearRichPresence', {});
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
   * 上报 int 型统计数据
   * 自动批量 storeStats，5s 内去抖
   * @param {string} name Steamworks 统计项名称
   * @param {number} value 值
   */
  reportStat(name, value) {
    if (!this._enabled || !name) return;
    this._statBuffer[name] = value;
    if (this._storeTimer) clearTimeout(this._storeTimer);
    this._storeTimer = setTimeout(() => this._flushStats(), 5000);
  }

  /**
   * 增加统计数据
   * @param {string} name 统计项名称
   * @param {number} delta 增量
   */
  incrementStat(name, delta = 1) {
    if (!this._enabled || !name) return;
    // 需要先获取当前值，再增加
    this._api.steamRPC('getStatInt', { name }).then(result => {
      if (result.ok) {
        this.reportStat(name, (result.value || 0) + delta);
      }
    }).catch(() => {
      // 如果获取失败，直接设置增量（首次）
      this.reportStat(name, delta);
    });
  }

  /**
   * 立即刷新统计数据到 Steam
   */
  flushStats() {
    if (this._storeTimer) {
      clearTimeout(this._storeTimer);
      this._storeTimer = null;
    }
    this._flushStats();
  }

  async _flushStats() {
    if (!this._enabled || Object.keys(this._statBuffer).length === 0) return;

    const stats = { ...this._statBuffer };

    try {
      for (const [name, value] of Object.entries(stats)) {
        await this._api.steamRPC('setStatInt', { name, value });
      }
      await this._api.steamRPC('storeStats', {});
      // 写入成功后才清除已同步的项
      for (const name of Object.keys(stats)) {
        delete this._statBuffer[name];
      }
      console.log('[steam-bridge] 统计已同步:', Object.keys(stats).join(', '));
    } catch (e) {
      console.error('[steam-bridge] 统计同步失败:', e.message);
    }

    this._storeTimer = null;
  }

  /**
   * 检查成就是否已解锁
   * @param {string} id 成就 ID
   * @returns {Promise<boolean>}
   */
  async isAchievementUnlocked(id) {
    if (!this._enabled || !id) return false;
    const steamId = ACH_MAP[id] ?? id;
    try {
      // greenworks 可能有 getAchievement 方法
      // 如果没有，默认返回 false
      const result = await this._api.steamRPC('getAchievement', { id: steamId });
      return result?.unlocked === true;
    } catch (e) {
      return false;
    }
  }
}

// 导出常量供外部使用
export { ACH_MAP, ACH_DISPLAY_NAMES, RICH_PRESENCE };