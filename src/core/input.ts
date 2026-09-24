/**
 * Pointer-locked mouse + keyboard.
 *
 * Raw input: Chromium supports `requestPointerLock({ unadjustedMovement: true })`, which bypasses
 * OS pointer acceleration ("Enhance pointer precision") and reports true mouse counts. Without it,
 * sensitivity maths is only as accurate as your OS settings.
 */

type LookFn = (dx: number, dy: number) => void;
type ButtonFn = (button: number, down: boolean) => void;
type KeyFn = (code: string, down: boolean) => void;

const GAME_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ShiftLeft', 'ControlLeft', 'Tab', 'KeyR']);

export class Input {
  readonly keys = new Set<string>();
  buttons = 0;
  locked = false;
  rawActive = false;
  /** Signed raw counts accumulated while locked (for the DPI analyser). */
  countsX = 0;
  countsY = 0;
  scale = 1;
  keyboardLocked = false;

  onLook: LookFn = () => {};
  onButton: ButtonFn = () => {};
  onKey: KeyFn = () => {};
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private readonly el: HTMLElement) {
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.el;
      if (locked === this.locked) return;
      this.locked = locked;
      if (!locked) {
        this.keys.clear();
        this.buttons = 0;
      }
      this.onLockChange(locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = e.movementX * this.scale;
      const dy = e.movementY * this.scale;
      this.countsX += e.movementX;
      this.countsY += e.movementY;
      if (dx !== 0 || dy !== 0) this.onLook(dx, dy);
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons |= 1 << e.button;
      this.onButton(e.button, true);
    });
    document.addEventListener('mouseup', (e) => {
      if (!this.locked) return;
      this.buttons &= ~(1 << e.button);
      this.onButton(e.button, false);
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (GAME_KEYS.has(e.code) || e.code.startsWith('Digit') || e.code.startsWith('Bracket')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.onKey(e.code, true);
    });
    window.addEventListener('keyup', (e) => {
      if (!this.keys.has(e.code)) return;
      this.keys.delete(e.code);
      this.onKey(e.code, false);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = 0;
    });
  }

  get supportsPointerLock(): boolean {
    return 'requestPointerLock' in this.el;
  }

  /** Resolve once the browser confirms (or refuses) the lock. */
  private waitForLock(): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (v: boolean) => {
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        clearTimeout(timer);
        resolve(v);
      };
      const onChange = () => finish(document.pointerLockElement === this.el);
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(document.pointerLockElement === this.el), 1200);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
    });
  }

  async lock(raw: boolean): Promise<boolean> {
    if (this.locked) return true;
    const req = this.el.requestPointerLock as unknown as (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    const attempt = async (opts?: { unadjustedMovement: boolean }): Promise<boolean> => {
      const confirmed = this.waitForLock();
      try {
        // Chromium returns a promise; Firefox/Safari return undefined and report via events.
        await req.call(this.el, opts);
      } catch {
        return false;
      }
      return confirmed;
    };
    if (raw && (await attempt({ unadjustedMovement: true }))) {
      this.rawActive = true;
      return true;
    }
    // No raw support (or it was refused): fall back to the OS-processed stream.
    this.rawActive = false;
    return attempt();
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  axis(neg: string, pos: string): number {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  get crouchHeld(): boolean {
    return (
      this.keys.has('KeyC') || this.keys.has('ShiftLeft') || (this.keyboardLocked && this.keys.has('ControlLeft'))
    );
  }

  get fireHeld(): boolean {
    return (this.buttons & 1) !== 0;
  }
}
