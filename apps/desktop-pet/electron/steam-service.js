/**
 * steam-service.js — Steam SDK 封装层（greenworks）
 *
 * 提供成就解锁、Rich Presence、统计数据上报等功能。
 * 仅在主进程运行，通过 IPC 与渲染进程通信。
 *
 * 设计原则：
 * - 不静默降级：初始化失败要明确告知用户
 * - 状态可查询：Steam 运行状态、用户登录状态、当前游戏
 * - 事件驱动：成就解锁、状态变化都通过 IPC 通知渲染进程
 */

class SteamService {
  constructor() {
    this._enabled = false;
    this._gw = null; // greenworks 实例
    this._initError = null; // 初始化错误原因
    this._steamRunning = false;
    this._userLoggedIn = false;
    this._currentGame = null; // { appId, name }
    this._mainWindow = null; // 用于发送事件
    this._pollInterval = null; // 状态轮询
  }

  /**
   * 设置主窗口引用（用于发送事件）
   * @param {BrowserWindow} win
   */
  setMainWindow(win) {
    this._mainWindow = win;
  }

  /**
   * 初始化 Steam SDK
   * @returns {{ ok: boolean, error?: string, details?: string }}
   */
  init() {
    try {
      // 1. 尝试加载 greenworks
      try {
        this._gw = require('greenworks');
      } catch (e) {
        this._initError = 'greenworks_not_installed';
        const msg = this._formatInitError();
        console.error('[steam] 初始化失败:', msg);
        return { ok: false, error: this._initError, details: msg };
      }

      // 2. 检查 Steam 是否运行
      if (!this._gw.isSteamRunning()) {
        this._initError = 'steam_not_running';
        const msg = 'Steam 未运行。请先启动 Steam 客户端再启动宠物。';
        console.warn('[steam]', msg);
        return { ok: false, error: this._initError, details: msg };
      }
      this._steamRunning = true;

      // 3. 初始化 Steam API
      if (!this._gw.initAPI()) {
        this._initError = 'init_failed';
        const msg = 'Steam SDK initAPI() 失败。可能原因：\n' +
                    '- steam_appid.txt 缺失或 AppID 无效\n' +
                    '- Steam 客户端版本过旧\n' +
                    '- 应用未在 Steamworks 后台正确配置';
        console.error('[steam]', msg);
        return { ok: false, error: this._initError, details: msg };
      }

      // 4. 检查用户是否登录
      this._userLoggedIn = this._gw.isLoggedOn();
      if (!this._userLoggedIn) {
        console.warn('[steam] 用户未登录 Steam，部分功能受限');
        // 仍然允许初始化成功，但标记状态
      }

      this._enabled = true;
      this._initError = null;

      const appId = this._gw.getAppId();
      console.log(`[steam] ✅ SDK 初始化成功！AppID: ${appId}, 用户登录: ${this._userLoggedIn}`);

      // 5. 启动状态轮询（检测 Steam 关闭/重启）
      this._startStatusPolling();

      return { ok: true, appId, userLoggedIn: this._userLoggedIn };
    } catch (e) {
      this._initError = 'exception';
      console.error('[steam] 初始化异常:', e.message);
      return { ok: false, error: 'exception', details: e.message };
    }
  }

  /**
   * 格式化初始化错误为用户友好消息
   */
  _formatInitError() {
    switch (this._initError) {
      case 'greenworks_not_installed':
        return 'Steam 集成模块未安装。Steam 功能暂不可用。\n' +
               '（开发环境需要安装 greenworks 依赖）';
      case 'steam_not_running':
        return 'Steam 客户端未运行。请启动 Steam 后重新打开宠物。';
      case 'init_failed':
        return 'Steam SDK 初始化失败。请检查 steam_appid.txt 配置。';
      case 'not_logged_in':
        return '您尚未登录 Steam。请登录后重新打开宠物。';
      default:
        return `Steam 初始化失败：${this._initError}`;
    }
  }

  /**
   * 启动状态轮询（每 5 秒检查一次）
   */
  _startStatusPolling() {
    if (this._pollInterval) clearInterval(this._pollInterval);

    this._pollInterval = setInterval(() => {
      if (!this._gw) return;

      const wasRunning = this._steamRunning;
      const wasLoggedIn = this._userLoggedIn;

      // 检查 Steam 运行状态
      this._steamRunning = this._gw.isSteamRunning?.() ?? false;

      // 检查用户登录状态
      this._userLoggedIn = this._gw.isLoggedOn?.() ?? false;

      // 状态变化时通知渲染进程
      if (wasRunning !== this._steamRunning || wasLoggedIn !== this._userLoggedIn) {
        this._emitStatusChange();
      }

      // Steam 关闭时禁用功能
      if (!this._steamRunning && this._enabled) {
        this._enabled = false;
        console.warn('[steam] Steam 已关闭，功能暂停');
      } else if (this._steamRunning && !this._enabled && !this._initError) {
        // Steam 重启时尝试恢复
        this._enabled = true;
        console.log('[steam] Steam 重新连接，功能恢复');
      }
    }, 5000);
  }

  /**
   * 发送状态变化事件到渲染进程
   */
  _emitStatusChange() {
    const status = this.getStatus();
    this._mainWindow?.webContents?.send?.('steam-status', status);
  }

  /**
   * 发送成就解锁事件到渲染进程
   */
  _emitAchievementUnlocked(achievementId, displayName) {
    this._mainWindow?.webContents?.send?.('steam-achievement', {
      id: achievementId,
      displayName,
      timestamp: Date.now()
    });
  }

  /**
   * 获取当前 Steam 状态
   * @returns {object}
   */
  getStatus() {
    return {
      enabled: this._enabled,
      steamRunning: this._steamRunning,
      userLoggedIn: this._userLoggedIn,
      initError: this._initError,
      initErrorDetails: this._initError ? this._formatInitError() : null,
      appId: this._enabled ? this._gw?.getAppId?.() : null,
    };
  }

  /**
   * 获取初始化错误信息（用于 UI 显示）
   */
  getInitError() {
    if (!this._initError) return null;
    return {
      error: this._initError,
      message: this._formatInitError()
    };
  }

  /**
   * 分发 Steam RPC 调用
   * @param {string} method 方法名
   * @param {object} params 参数
   * @returns {object} 结果
   */
  dispatch(method, params = {}) {
    // 特殊方法：不依赖 Steam 运行状态
    if (method === 'getStatus') {
      return { ok: true, ...this.getStatus() };
    }
    if (method === 'getInitError') {
      return { ok: true, ...this.getInitError() };
    }

    // 其他方法需要 Steam 运行
    if (!this._enabled) {
      const reason = this._initError || 'disabled';
      console.warn(`[steam] dispatch(${method}) 失败: Steam 未启用 (${reason})`);
      return { ok: false, reason, error: this._formatInitError() };
    }

    try {
      switch (method) {
        case 'activateAchievement':
          return this._activateAchievement(params.id, params.displayName);
        case 'setRichPresence':
          return this._setRichPresence(params.key, params.value ?? '');
        case 'clearRichPresence':
          return this._clearRichPresence();
        case 'setStatInt':
          return this._setStatInt(params.name, params.value);
        case 'getStatInt':
          return this._getStatInt(params.name);
        case 'storeStats':
          return this._storeStats();
        case 'isEnabled':
          return { ok: true, enabled: this._enabled };
        case 'getAppId':
          return { ok: true, appId: this._gw.getAppId() };
        case 'getPersonaName':
          return this._getPersonaName();
        case 'getCurrentGame':
          return { ok: true, game: this._currentGame };
        default:
          return { ok: false, reason: `unknown method: ${method}` };
      }
    } catch (e) {
      console.error(`[steam] dispatch(${method}) 异常:`, e.message);
      return { ok: false, reason: e.message, error: e.message };
    }
  }

  /**
   * 解锁成就
   * @param {string} id Steam 成就 API Name
   * @param {string} displayName 可选的显示名称（用于 UI）
   */
  _activateAchievement(id, displayName) {
    if (!id) return { ok: false, reason: 'missing achievement id' };

    return new Promise((resolve) => {
      this._gw.activateAchievement(id, () => {
        console.log(`[steam] 🏆 成就解锁: ${id}`);
        // 通知渲染进程播放动画
        this._emitAchievementUnlocked(id, displayName || id);
        // 自动存储
        this._gw.storeStats();
        resolve({ ok: true, id });
      }, (err) => {
        console.error(`[steam] 成就解锁失败 (${id}):`, err);
        resolve({ ok: false, reason: String(err) });
      });
    }).then(r => r);
  }

  /**
   * 设置 Rich Presence
   * @param {string} key 键名
   * @param {string} value 值
   */
  _setRichPresence(key, value) {
    if (!key) return { ok: false, reason: 'missing key' };
    this._gw.setRichPresence(key, value);
    return { ok: true };
  }

  /**
   * 清除 Rich Presence
   */
  _clearRichPresence() {
    this._gw.clearRichPresence?.();
    return { ok: true };
  }

  /**
   * 设置 int 型统计数据
   * @param {string} name 统计项名称
   * @param {number} value 值
   */
  _setStatInt(name, value) {
    if (!name) return { ok: false, reason: 'missing stat name' };
    this._gw.setStatInt(name, value);
    return { ok: true };
  }

  /**
   * 获取 int 型统计数据
   * @param {string} name 统计项名称
   */
  _getStatInt(name) {
    if (!name) return { ok: false, reason: 'missing stat name' };
    const value = this._gw.getStatInt(name);
    return { ok: true, value };
  }

  /**
   * 保存统计数据到 Steam 服务器
   */
  _storeStats() {
    return new Promise((resolve) => {
      this._gw.storeStats(() => {
        console.log('[steam] 统计数据已同步');
        resolve({ ok: true });
      }, (err) => {
        console.error('[steam] 统计同步失败:', err);
        resolve({ ok: false, reason: String(err) });
      });
    }).then(r => r);
  }

  /**
   * 获取当前用户昵称
   */
  _getPersonaName() {
    try {
      const steamId = this._gw.getSteamId?.();
      if (!steamId) return { ok: false, reason: '无法获取 Steam ID' };
      // greenworks 可能不直接支持，返回占位
      return { ok: true, name: 'Steam用户' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
   * 设置当前游戏信息（供宠物感知）
   * @param {object} game { appId, name }
   */
  setCurrentGame(game) {
    this._currentGame = game || null;
    // 通知渲染进程
    this._mainWindow?.webContents?.send?.('steam-game-changed', this._currentGame);
  }

  /**
   * 关闭 Steam SDK
   */
  shutdown() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this._enabled && this._gw) {
      try {
        // greenworks 可能没有 shutdown 方法
        this._gw.shutdown?.();
        console.log('[steam] SDK 已关闭');
      } catch (e) {
        console.warn('[steam] shutdown 异常:', e.message);
      }
      this._enabled = false;
    }
  }
}

module.exports = { SteamService };