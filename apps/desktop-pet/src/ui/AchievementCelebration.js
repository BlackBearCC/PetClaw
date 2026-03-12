/**
 * AchievementCelebration.js — Steam 成就解锁庆祝动画
 *
 * 当 Steam 成就解锁时播放：
 * - 飘落的彩带/星星
 * - 成就图标弹出
 * - 宠物触发 happy 动画
 */

export class AchievementCelebration {
  /**
   * @param {HTMLElement} container 容器元素
   * @param {object} options 配置
   * @param {(anim: string, duration: number) => void} options.onPetAnimation 触发宠物动画
   * @param {(msg: string, duration: number) => void} options.onBubble 显示气泡
   */
  constructor(container, options = {}) {
    this._container = container;
    this._options = options;
    this._queue = [];
    this._playing = false;
    this._el = null;
    this._nextTimer = null;
  }

  /**
   * 播放成就解锁动画
   * @param {{id: string, displayName: string}} achievement
   */
  play(achievement) {
    this._queue.push(achievement);
    if (!this._playing) {
      this._processQueue();
    }
  }

  /**
   * 处理动画队列
   */
  async _processQueue() {
    if (this._queue.length === 0) {
      this._playing = false;
      return;
    }

    this._playing = true;
    const achievement = this._queue.shift();
    await this._playAnimation(achievement);

    // 短暂间隔后处理下一个
    this._nextTimer = setTimeout(() => this._processQueue(), 500);
  }

  /**
   * 播放单个动画
   */
  async _playAnimation(achievement) {
    // 1. 触发宠物动画
    this._options.onPetAnimation?.('happy', 3000);

    // 2. 显示气泡
    const messages = [
      `🏆 成就解锁：${achievement.displayName}！`,
      `太棒了！解锁「${achievement.displayName}」！`,
      `喵呜！获得成就：${achievement.displayName}！✨`,
    ];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    this._options.onBubble?.(msg, 4000);

    // 3. 播放视觉效果
    this._playParticles();
    this._playAchievementPopup(achievement);
  }

  /**
   * 播放粒子效果
   */
  _playParticles() {
    const particleCount = 30;
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#A8E6CF', '#FFB347', '#87CEEB'];

    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'achievement-particle';
      
      const color = colors[Math.floor(Math.random() * colors.length)];
      const startX = 128 + (Math.random() - 0.5) * 100; // 宠物中心附近
      const startY = 200;
      const endX = startX + (Math.random() - 0.5) * 200;
      const endY = startY + 100 + Math.random() * 100;
      const rotation = Math.random() * 720 - 360;
      const size = 4 + Math.random() * 8;
      const duration = 1 + Math.random() * 0.5;
      const delay = Math.random() * 0.3;

      particle.style.cssText = `
        position: absolute;
        left: ${startX}px;
        top: ${startY}px;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        pointer-events: none;
        z-index: 1000;
        animation: achievement-particle-fly ${duration}s ease-out ${delay}s forwards;
        --end-x: ${endX - startX}px;
        --end-y: ${endY - startY}px;
        --rotation: ${rotation}deg;
      `;

      this._container.appendChild(particle);

      // 动画结束后移除
      setTimeout(() => particle.remove(), (duration + delay) * 1000 + 100);
    }
  }

  /**
   * 播放成就弹出
   */
  _playAchievementPopup(achievement) {
    const popup = document.createElement('div');
    popup.className = 'achievement-popup';
    popup.innerHTML = `
      <div class="achievement-popup-content">
        <div class="achievement-icon">🏆</div>
        <div class="achievement-info">
          <div class="achievement-label">Achievement Unlocked</div>
          <div class="achievement-name">${achievement.displayName}</div>
        </div>
      </div>
    `;

    this._container.appendChild(popup);

    // 触发动画
    requestAnimationFrame(() => {
      popup.classList.add('show');
    });

    // 3秒后移除
    setTimeout(() => {
      popup.classList.add('hide');
      setTimeout(() => popup.remove(), 300);
    }, 3000);
  }

  /**
   * 注入样式（首次调用时）
   */
  static injectStyles() {
    if (document.getElementById('achievement-styles')) return;

    const style = document.createElement('style');
    style.id = 'achievement-styles';
    style.textContent = `
      @keyframes achievement-particle-fly {
        0% {
          transform: translate(0, 0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translate(var(--end-x), var(--end-y)) rotate(var(--rotation));
          opacity: 0;
        }
      }

      .achievement-particle {
        will-change: transform, opacity;
      }

      .achievement-popup {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0);
        z-index: 1001;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }

      .achievement-popup.show {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
      }

      .achievement-popup.hide {
        transform: translate(-50%, -50%) scale(0.8);
        opacity: 0;
      }

      .achievement-popup-content {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px 24px;
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.9), rgba(255, 165, 0, 0.9));
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(255, 215, 0, 0.4), 0 0 40px rgba(255, 215, 0, 0.2);
      }

      .achievement-icon {
        font-size: 32px;
        animation: achievement-icon-bounce 0.5s ease-out;
      }

      @keyframes achievement-icon-bounce {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.2); }
      }

      .achievement-info {
        text-align: left;
      }

      .achievement-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: rgba(0, 0, 0, 0.6);
        margin-bottom: 2px;
      }

      .achievement-name {
        font-size: 16px;
        font-weight: 700;
        color: #000;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 销毁
   */
  destroy() {
    this._queue = [];
    this._playing = false;
    if (this._nextTimer) {
      clearTimeout(this._nextTimer);
      this._nextTimer = null;
    }
  }
}

// 自动注入样式
AchievementCelebration.injectStyles();