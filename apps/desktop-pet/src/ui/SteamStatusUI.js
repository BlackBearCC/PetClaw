/**
 * SteamStatusUI.js — Steam 连接状态显示组件
 *
 * 在宠物状态栏显示 Steam 连接状态：
 * - 已连接：绿色图标
 * - 未运行：灰色图标 + 提示
 * - 未登录：黄色图标
 * - 错误：红色图标
 */

export class SteamStatusUI {
  /**
   * @param {HTMLElement} container 父容器
   * @param {SteamBridge} steamBridge Steam 桥接实例
   */
  constructor(container, steamBridge) {
    this._container = container;
    this._steam = steamBridge;
    this._el = null;
    this._tooltipEl = null;
    this._status = null;
  }

  /**
   * 初始化并渲染 UI
   */
  init() {
    // 创建状态指示器
    this._el = document.createElement('div');
    this._el.className = 'steam-status';
    this._el.innerHTML = `
      <div class="steam-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </div>
      <span class="steam-label">Steam</span>
    `;

    // 创建提示框
    this._tooltipEl = document.createElement('div');
    this._tooltipEl.className = 'steam-tooltip';
    this._el.appendChild(this._tooltipEl);

    // 添加到容器
    this._container.appendChild(this._el);

    // 注册状态变化监听
    this._steam.onStatusChange((status) => {
      this._updateUI(status);
    });

    // 初始渲染
    this._updateUI(this._steam.status);

    // 点击显示详情
    this._el.addEventListener('click', () => {
      this._showDetails();
    });

    // 添加样式
    this._injectStyles();
  }

  /**
   * 更新 UI 状态
   */
  _updateUI(status) {
    if (!status) {
      this._el.className = 'steam-status steam-unknown';
      this._tooltipEl.textContent = 'Steam 状态未知';
      return;
    }

    this._status = status;

    if (status.enabled && status.steamRunning && status.userLoggedIn) {
      // 完全正常
      this._el.className = 'steam-status steam-connected';
      this._tooltipEl.textContent = `Steam 已连接 (AppID: ${status.appId})`;
    } else if (status.enabled && status.steamRunning && !status.userLoggedIn) {
      // 运行但未登录
      this._el.className = 'steam-status steam-logged-out';
      this._tooltipEl.textContent = 'Steam 运行中，但用户未登录';
    } else if (!status.steamRunning) {
      // Steam 未运行
      this._el.className = 'steam-status steam-not-running';
      this._tooltipEl.textContent = 'Steam 未运行';
    } else if (status.initError) {
      // 初始化错误
      this._el.className = 'steam-status steam-error';
      this._tooltipEl.textContent = status.initErrorDetails || 'Steam 初始化失败';
    } else {
      this._el.className = 'steam-status steam-disabled';
      this._tooltipEl.textContent = 'Steam 功能已禁用';
    }
  }

  /**
   * 显示详情对话框
   */
  _showDetails() {
    if (!this._status) return;

    const initResult = this._steam.initResult;
    if (initResult && !initResult.ok) {
      // 显示错误详情
      this._showErrorDialog(initResult);
    } else {
      // 显示正常状态
      this._showInfoDialog(this._status);
    }
  }

  /**
   * 显示错误对话框
   */
  _showErrorDialog(result) {
    document.querySelector('.steam-dialog')?.remove();
    const dialog = document.createElement('div');
    dialog.className = 'steam-dialog';
    dialog.innerHTML = `
      <div class="steam-dialog-content">
        <div class="steam-dialog-header">
          <span class="steam-dialog-title">⚠️ Steam 连接失败</span>
          <button class="steam-dialog-close">&times;</button>
        </div>
        <div class="steam-dialog-body">
          <p class="steam-error-message">${result.details || '未知错误'}</p>
          <div class="steam-suggestions">
            <p><strong>建议：</strong></p>
            <ul>
              <li>确保 Steam 客户端正在运行</li>
              <li>确保已登录 Steam 账号</li>
              <li>检查 steam_appid.txt 文件是否存在</li>
              <li>重启应用后再试</li>
            </ul>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 点击背景关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    // 点击关闭按钮
    dialog.querySelector('.steam-dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
  }

  /**
   * 显示信息对话框
   */
  _showInfoDialog(status) {
    document.querySelector('.steam-dialog')?.remove();
    const dialog = document.createElement('div');
    dialog.className = 'steam-dialog';
    dialog.innerHTML = `
      <div class="steam-dialog-content">
        <div class="steam-dialog-header">
          <span class="steam-dialog-title">🎮 Steam 状态</span>
          <button class="steam-dialog-close">&times;</button>
        </div>
        <div class="steam-dialog-body">
          <div class="steam-info-grid">
            <div class="steam-info-item">
              <span class="steam-info-label">App ID</span>
              <span class="steam-info-value">${status.appId || 'N/A'}</span>
            </div>
            <div class="steam-info-item">
              <span class="steam-info-label">Steam 状态</span>
              <span class="steam-info-value ${status.steamRunning ? 'status-ok' : 'status-error'}">
                ${status.steamRunning ? '✅ 运行中' : '❌ 未运行'}
              </span>
            </div>
            <div class="steam-info-item">
              <span class="steam-info-label">用户登录</span>
              <span class="steam-info-value ${status.userLoggedIn ? 'status-ok' : 'status-warning'}">
                ${status.userLoggedIn ? '✅ 已登录' : '⚠️ 未登录'}
              </span>
            </div>
          </div>
          <p class="steam-hint">成就和统计数据会自动同步到 Steam</p>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    dialog.querySelector('.steam-dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
  }

  /**
   * 注入样式
   */
  _injectStyles() {
    if (document.getElementById('steam-status-styles')) return;

    const style = document.createElement('style');
    style.id = 'steam-status-styles';
    style.textContent = `
      .steam-status {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
        z-index: 100;
      }

      .steam-status:hover {
        transform: scale(1.05);
      }

      .steam-icon {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .steam-label {
        font-weight: 500;
      }

      /* 已连接 */
      .steam-connected {
        background: rgba(76, 175, 80, 0.2);
        color: #4CAF50;
        border: 1px solid rgba(76, 175, 80, 0.3);
      }

      /* 未运行 */
      .steam-not-running {
        background: rgba(158, 158, 158, 0.2);
        color: #9E9E9E;
        border: 1px solid rgba(158, 158, 158, 0.3);
      }

      /* 未登录 */
      .steam-logged-out {
        background: rgba(255, 193, 7, 0.2);
        color: #FFC107;
        border: 1px solid rgba(255, 193, 7, 0.3);
      }

      /* 错误 */
      .steam-error {
        background: rgba(244, 67, 54, 0.2);
        color: #F44336;
        border: 1px solid rgba(244, 67, 54, 0.3);
      }

      /* 禁用 */
      .steam-disabled {
        background: rgba(158, 158, 158, 0.1);
        color: #757575;
        border: 1px solid rgba(158, 158, 158, 0.2);
      }

      /* 未知 */
      .steam-unknown {
        background: rgba(158, 158, 158, 0.1);
        color: #9E9E9E;
        border: 1px solid rgba(158, 158, 158, 0.2);
      }

      /* 提示框 */
      .steam-tooltip {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        padding: 6px 10px;
        background: rgba(30, 30, 30, 0.95);
        color: #fff;
        font-size: 11px;
        border-radius: 6px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        z-index: 101;
      }

      .steam-status:hover .steam-tooltip {
        opacity: 1;
      }

      /* 对话框 */
      .steam-dialog {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .steam-dialog-content {
        background: #2a2a2a;
        border-radius: 12px;
        max-width: 360px;
        width: 90%;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }

      .steam-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .steam-dialog-title {
        font-size: 14px;
        font-weight: 600;
        color: #fff;
      }

      .steam-dialog-close {
        background: none;
        border: none;
        color: #888;
        font-size: 20px;
        cursor: pointer;
        line-height: 1;
      }

      .steam-dialog-close:hover {
        color: #fff;
      }

      .steam-dialog-body {
        padding: 16px;
      }

      .steam-error-message {
        color: #F44336;
        font-size: 13px;
        margin-bottom: 12px;
      }

      .steam-suggestions {
        color: #aaa;
        font-size: 12px;
      }

      .steam-suggestions ul {
        margin: 8px 0 0 0;
        padding-left: 20px;
      }

      .steam-suggestions li {
        margin: 4px 0;
      }

      .steam-info-grid {
        display: grid;
        gap: 12px;
      }

      .steam-info-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .steam-info-label {
        color: #888;
        font-size: 12px;
      }

      .steam-info-value {
        color: #fff;
        font-size: 12px;
        font-weight: 500;
      }

      .steam-info-value.status-ok {
        color: #4CAF50;
      }

      .steam-info-value.status-warning {
        color: #FFC107;
      }

      .steam-info-value.status-error {
        color: #F44336;
      }

      .steam-hint {
        margin-top: 12px;
        color: #666;
        font-size: 11px;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 销毁
   */
  destroy() {
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }
}