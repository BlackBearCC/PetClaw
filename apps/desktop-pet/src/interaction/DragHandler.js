/**
 * DragHandler.js
 * 拖拽逻辑 — 让用户可以拖动宠物到桌面任意位置
 *
 * 实现：
 * - mousedown 开始拖拽，切换到 drag 状态
 * - mousemove 移动 Electron 窗口位置
 * - mouseup 结束拖拽，回到 idle
 */

export class DragHandler {
  /**
   * @param {HTMLElement} element - 拖拽触发元素（canvas）
   * @param {import('../character/StateMachine').StateMachine} stateMachine
   * @param {import('../character/Behaviors').Behaviors} behaviors
   * @param {object} electronAPI - preload 暴露的 Electron API
   */
  constructor(element, stateMachine, behaviors, electronAPI) {
    this.element = element;
    this.sm = stateMachine;
    this.behaviors = behaviors;
    this.electronAPI = electronAPI;

    this.isDragging = false;
    this._isMouseDown = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this._dragThreshold = 5; // 移动超过 5px 才算拖拽

    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    this.element.addEventListener('mousedown', this._onMouseDown);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;

    this._isMouseDown = true;
    this.isDragging = false; // 不立即进入拖拽
    this.dragStartX = e.screenX;
    this.dragStartY = e.screenY;

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  _onMouseMove(e) {
    if (!this._isMouseDown) return;

    const dx = e.screenX - this.dragStartX;
    const dy = e.screenY - this.dragStartY;

    // 首次达到阈值时才进入拖拽模式
    if (!this.isDragging) {
      if (Math.abs(dx) + Math.abs(dy) < this._dragThreshold) return;
      this.isDragging = true;
      this.sm.transition('drag', { force: true });
      this.behaviors.recordInteraction();
      // 拖拽期间锁定鼠标不穿透，防止 Windows 丢失鼠标捕获导致坐标跳变
      if (this.electronAPI?.setIgnoreMouse) this.electronAPI.setIgnoreMouse(false);
    }

    if (this.electronAPI?.moveWindow) {
      this.electronAPI.moveWindow(dx, dy);
    }

    this.dragStartX = e.screenX;
    this.dragStartY = e.screenY;
  }

  async _onMouseUp(e) {
    const wasDragging = this.isDragging;
    this._isMouseDown = false;
    this.isDragging = false;

    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    // 拖拽结束，恢复穿透（_setupMousePassthrough 在下次 mousemove 精确接管）
    if (wasDragging && this.electronAPI?.setIgnoreMouse) {
      this.electronAPI.setIgnoreMouse(true);
    }

    if (!wasDragging) return;

    // 边缘吸附检测
    if (this.electronAPI?.getWindowPosition && this.electronAPI?.getScreenSize) {
      try {
        const pos = await this.electronAPI.getWindowPosition();
        const screen = await this.electronAPI.getScreenSize();
        const SNAP = 30;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        // 宠物区域在窗口最右侧 256px，吸附基于宠物位置而非窗口位置
        const petAreaW = 256;
        const petOffset = winW - petAreaW; // 窗口左侧透明区宽度
        const petLeft = pos.x + petOffset;
        const petRight = pos.x + winW;
        let snapped = null;
        let snapX = pos.x;
        let snapY = pos.y;

        if (petLeft <= SNAP) { snapX = SNAP - petOffset; snapped = 'left'; }
        else if (petRight >= screen.width - SNAP) { snapX = screen.width - winW; snapped = 'right'; }

        if (pos.y <= SNAP) { snapY = 0; snapped = snapped || 'top'; }
        else if (pos.y + winH >= screen.height - SNAP) { snapY = screen.height - winH; snapped = snapped || 'bottom'; }

        if (snapped) {
          this.electronAPI.moveWindow(snapX - pos.x, snapY - pos.y);
        }

        this.behaviors.setPosition(snapX, snapY);
        this.behaviors.setEdgeSnapped(snapped);
        this.sm.transition(snapped ? 'edge_idle' : 'idle', { force: true });
      } catch {
        this.sm.transition('idle', { force: true });
      }
    } else {
      this.sm.transition('idle', { force: true });
    }
  }

  destroy() {
    this.element.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
  }
}
