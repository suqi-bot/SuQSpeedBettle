export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  dash: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  fire: boolean;
  firePressed: boolean;
  skillPressed: boolean;
  reloadPressed: boolean;
  interactPressed: boolean;
  switchPressed: boolean;
  switchCycle: boolean;
  switchTo: number;
  mouseDX: number;
  mouseDY: number;
  locked: boolean;
}

export class Input {
  readonly state: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    dash: false,
    jumpPressed: false,
    dashPressed: false,
    fire: false,
    firePressed: false,
    skillPressed: false,
    reloadPressed: false,
    interactPressed: false,
    switchPressed: false,
    switchCycle: false,
    switchTo: -1,
    mouseDX: 0,
    mouseDY: 0,
    locked: false,
  };

  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = false;
  private mouseDownPressed = false;
  private fallback = false;
  private lockRequestedAt = 0;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.state.locked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseDownPressed = true;
      }
      if (e.button === 2) this.pressed.add('MouseRight');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      this.state.locked = locked;
      if (locked) this.fallback = false;
    });
    document.addEventListener('pointerlockerror', () => {
      // 某些内嵌环境（iframe/Electron 外壳）不允许 pointer lock，退回无锁模式
      this.enableFallback();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.state.locked) return;
      const mx = typeof e.movementX === 'number' ? e.movementX : e.clientX - this.lastX;
      const my = typeof e.movementY === 'number' ? e.movementY : e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.state.mouseDX += mx;
      this.state.mouseDY += my;
    });
  }

  private lastX = 0;
  private lastY = 0;

  private requestLock(): void {
    this.lockRequestedAt = performance.now();
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => this.enableFallback());
    } catch {
      this.enableFallback();
    }
  }

  private enableFallback(): void {
    this.fallback = true;
    this.state.locked = true;
  }

  /** 每帧开始：把事件型输入同步到 state */
  poll(): void {
    // 请求锁但 350ms 后仍未获得：进入无锁降级模式（内嵌环境常见）
    if (!this.state.locked && this.lockRequestedAt > 0 && performance.now() - this.lockRequestedAt > 350) {
      this.enableFallback();
    }
    const s = this.state;
    s.forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    s.back = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    s.left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    s.right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    s.jump = this.keys.has('Space');
    s.dash = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    s.jumpPressed = this.pressed.has('Space');
    s.dashPressed = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
    s.fire = this.mouseDown;
    s.firePressed = this.mouseDownPressed;
    s.skillPressed = this.pressed.has('MouseRight');
    s.reloadPressed = this.pressed.has('KeyR');
    s.interactPressed = this.pressed.has('KeyE');
    s.switchPressed = this.pressed.has('KeyQ') || this.pressed.has('Digit1') || this.pressed.has('Digit2');
    s.switchCycle = this.pressed.has('KeyQ');
    s.switchTo = this.pressed.has('Digit1') ? 0 : this.pressed.has('Digit2') ? 1 : -1;
  }

  /** 每帧结束：清理“本帧按下” */
  flush(): void {
    this.pressed.clear();
    this.mouseDownPressed = false;
    this.state.mouseDX = 0;
    this.state.mouseDY = 0;
  }
}
