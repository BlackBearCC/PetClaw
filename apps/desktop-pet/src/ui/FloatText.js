/**
 * FloatText.js
 * 属性数值浮动提示（+3 心情 / -5 饱腹）
 * 出现在角色头顶附近，向上飘动淡出。
 */

const LABELS = { mood: '心情', hunger: '饱腹', health: '健康' };

// 正值颜色偏暖，负值偏冷灰
const COLORS = {
  mood:   { pos: '#FF8FAB', neg: '#90A4AE' },
  hunger: { pos: '#FFB347', neg: '#90A4AE' },
  health: { pos: '#81C995', neg: '#EF9A9A' },
};

export class FloatText {
  constructor(container) {
    this._container = container;
    this._seq = 0; // 用于横向错位，避免多条文字叠在一起
  }

  /**
   * @param {string} key   属性 key (mood / hunger / health)
   * @param {number} delta 变化量（正 = 增加，负 = 减少）
   */
  show(key, delta) {
    const rounded = Math.round(delta);
    if (rounded === 0) return;

    const label = LABELS[key] || key;
    const palette = COLORS[key] || { pos: '#A5D6A7', neg: '#EF9A9A' };
    const color = rounded > 0 ? palette.pos : palette.neg;
    const sign  = rounded > 0 ? '+' : '';

    const el = document.createElement('div');
    el.textContent = `${sign}${rounded} ${label}`;

    // 纵向小偏移，防止多属性同时变化时文字重叠
    const offsetY = (this._seq % 3) * 16; // 0, 16, 32
    this._seq++;

    el.style.cssText = `
      position: absolute;
      left: 62%;
      top: calc(18% + ${offsetY}px);
      color: ${color};
      font-size: 13px;
      font-weight: 700;
      font-family: sans-serif;
      pointer-events: none;
      white-space: nowrap;
      text-shadow: 0 1px 3px rgba(0,0,0,0.55);
      z-index: 300;
      letter-spacing: 0.3px;
    `;

    this._container.appendChild(el);

    el.animate(
      [
        { opacity: 1,   transform: `translateY(0px)`   },
        { opacity: 0.85, transform: `translateY(-18px)` },
        { opacity: 0,   transform: `translateY(-40px)` },
      ],
      { duration: 1600, easing: 'ease-out', fill: 'forwards' }
    ).onfinish = () => el.remove();
  }

  destroy() {}
}
