import { Vector3 } from 'three';
import type { Drill, DrillReport } from '../drills/drill';
import { Arena, bearingXZ, PLAY_RADIUS } from '../world/arena';
import { StrafeBrain, type Brain, type StrafeOptions } from '../world/brain';
import { Engine } from '../world/engine';
import { Figure, type HitPart } from '../world/figure';
import { Fx } from '../world/fx';
import { Mover } from '../world/movement';
import { PALETTE } from '../world/palette';
import { Viewmodel } from '../world/viewmodel';
import { greek, Hud } from '../ui/hud';
import { Audio } from './audio';
import { Input } from './input';
import { OW_YAW_DEG } from './sens';
import type { Settings } from './store';

export interface WeaponSpec {
  name: string;
  auto: boolean;
  /** Shots per second. */
  rate: number;
  body: number;
  head: number;
}

export const WEAPONS = {
  /** Soldier-style automatic hitscan: 10 rounds/s, crits ×2. */
  pulse: { name: 'Pulse', auto: true, rate: 10, body: 20, head: 40 } satisfies WeaponSpec,
  /** Cassidy-style semi-auto hitscan. */
  rail: { name: 'Rail', auto: false, rate: 3.2, body: 70, head: 140 } satisfies WeaponSpec,
};

export interface ShotResult {
  figure: Figure | null;
  part: HitPart | null;
  point: Vector3;
  kill: boolean;
  /** Seconds on the game clock when the shot was taken. */
  at: number;
}

type RunState = 'idle' | 'countdown' | 'running' | 'done';

const DEG = Math.PI / 180;
const _v = new Vector3();
const _d = new Vector3();
const _o = new Vector3();

export const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export class Game {
  readonly engine: Engine;
  readonly arena: Arena;
  readonly fx: Fx;
  readonly vm: Viewmodel;
  readonly input: Input;
  readonly audio = new Audio();
  readonly hud: Hud;
  readonly player: Mover;

  /** Radians. Positive yaw turns left (three.js convention); bearings are the clockwise mirror. */
  yaw = 0;
  pitch = 0;
  sens = 5;
  invertY = false;

  readonly figures: Figure[] = [];
  private readonly brains = new Map<Figure, Brain>();

  mode: 'attract' | 'play' = 'attract';
  paused = false;
  run: RunState = 'idle';
  drill: Drill | null = null;
  time = 0;
  /** Game-clock seconds of drill time, frozen while paused. */
  clock = 0;

  weapon: WeaponSpec | null = WEAPONS.pulse;
  viewmodelOn = true;
  private cooldown = 0;
  private heat = 0;
  private countdown = 0;
  private countdownLabel = '';
  private lastCount = -1;
  private onDone: ((r: DrillReport) => void) | null = null;
  private last = performance.now();
  private attractYaw = 0;

  onPause: (paused: boolean) => void = () => {};
  /** Extra per-frame hook for screens that animate with the scene. */
  onFrame: (dt: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.engine = new Engine(canvas);
    this.arena = new Arena(this.engine.scene);
    this.fx = new Fx(this.engine.scene);
    this.vm = new Viewmodel(this.engine.vmScene);
    this.hud = new Hud(overlay);
    this.player = new Mover(this.arena.colliders, PLAY_RADIUS);
    this.input = new Input(canvas);

    this.input.onLook = (dx, dy) => this.look(dx, dy);
    this.input.onButton = (b, down) => this.button(b, down);
    this.input.onKey = (code, down) => {
      if (down && this.mode === 'play' && !this.paused && this.run === 'running') this.drill?.onKey(code);
    };
    this.input.onLockChange = (locked) => {
      if (this.mode !== 'play') return;
      if (!locked && !this.paused && this.run !== 'done') {
        this.paused = true;
        this.onPause(true);
      }
    };
    this.spawnAttractBots();
  }

  // ---------------------------------------------------------------- settings

  applySettings(s: Settings): void {
    this.sens = s.sens;
    this.invertY = s.invertY;
    this.input.scale = s.inputScale;
    this.engine.setFov(s.fov);
    this.engine.setQuality(s.fx, s.renderScale);
    this.viewmodelOn = s.viewmodel;
    this.hud.setCrosshair(s.crosshair);
    this.hud.showFps(s.showFps);
    this.hud.setScopeEnabled(s.showScope);
    this.audio.setVolume(s.volume);
  }

  // ---------------------------------------------------------------- aim

  private look(dx: number, dy: number): void {
    if (this.mode !== 'play' || this.paused) return;
    const k = OW_YAW_DEG * this.sens * DEG;
    this.yaw -= dx * k;
    this.pitch -= (this.invertY ? -dy : dy) * k;
    const lim = 89 * DEG;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  aimDir(out = new Vector3()): Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  eye(out = new Vector3()): Vector3 {
    return out.set(this.player.pos.x, this.player.pos.y + this.player.eyeHeight, this.player.pos.z);
  }

  /** Aim in "bearing space": yaw grows clockwise (to the right) and is unwrapped; pitch grows up. Degrees. */
  aimAngles(): { yaw: number; pitch: number } {
    return { yaw: -this.yaw / DEG, pitch: this.pitch / DEG };
  }

  /** Direction to a world point in the same space, unwrapped next to the current aim. */
  anglesTo(p: Vector3): { yaw: number; pitch: number; dist: number } {
    this.eye(_o);
    const dx = p.x - _o.x;
    const dy = p.y - _o.y;
    const dz = p.z - _o.z;
    const h = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, -dz) / DEG;
    const aim = this.aimAngles();
    return {
      yaw: aim.yaw + wrap180(bearing - aim.yaw),
      pitch: Math.atan2(dy, h) / DEG,
      dist: Math.hypot(h, dy),
    };
  }

  /** Nearest thing along a ray: a figure or a piece of cover. */
  castRay(o: Vector3, d: Vector3, maxT = 400): { figure: Figure | null; part: HitPart | null; t: number } {
    let best = maxT;
    let figure: Figure | null = null;
    let part: HitPart | null = null;
    for (const b of this.arena.colliders) {
      const t = b.ray(o, d);
      if (t < best) {
        best = t;
        figure = null;
        part = null;
      }
    }
    for (const f of this.figures) {
      const h = f.ray(o, d);
      if (h && h.t < best) {
        best = h.t;
        figure = f;
        part = h.part;
      }
    }
    if (d.y < -1e-6) {
      const tg = -o.y / d.y;
      if (tg < best) {
        best = tg;
        figure = null;
        part = null;
      }
    }
    return { figure, part, t: best };
  }

  /** What the crosshair is on right now. */
  crosshairTarget(): { figure: Figure | null; part: HitPart | null; t: number } {
    return this.castRay(this.eye(_o), this.aimDir(_d));
  }

  /** Line of sight from the eye to a point (ignores figures). */
  canSee(p: Vector3): boolean {
    this.eye(_o);
    _d.copy(p).sub(_o);
    const len = _d.length();
    _d.divideScalar(len);
    for (const b of this.arena.colliders) if (b.ray(_o, _d) < len - 0.05) return false;
    return true;
  }

  // ---------------------------------------------------------------- figures

  spawnHumanoid(x: number, z: number, brain?: Partial<StrafeOptions> | Brain, color = PALETTE.targetCore): Figure {
    const f = new Figure('humanoid', this.arena.colliders, PLAY_RADIUS + 12, color);
    f.mover.teleport(x, 0, z);
    this.engine.scene.add(f.group);
    this.figures.push(f);
    if (brain && 'update' in brain) this.brains.set(f, brain as Brain);
    else if (brain) {
      this.brains.set(f, new StrafeBrain(f, { style: 'duel', lane: 5, near: 7, far: 18, ...(brain as Partial<StrafeOptions>) }));
    }
    return f;
  }

  spawnOrb(p: Vector3, radius: number): Figure {
    const f = new Figure('orb', this.arena.colliders, PLAY_RADIUS + 60);
    f.orbRadius = radius;
    f.hp = f.maxHp = 1;
    f.mover.teleport(p.x, p.y, p.z);
    f.mover.onGround = false;
    this.engine.scene.add(f.group);
    this.figures.push(f);
    return f;
  }

  setBrain(f: Figure, brain: Brain): void {
    this.brains.set(f, brain);
  }

  removeFigure(f: Figure): void {
    const i = this.figures.indexOf(f);
    if (i >= 0) this.figures.splice(i, 1);
    this.brains.delete(f);
    f.dispose();
  }

  clearFigures(): void {
    for (const f of [...this.figures]) this.removeFigure(f);
  }

  private spawnAttractBots(): void {
    for (const [b, r] of [
      [-20, 15],
      [25, 22],
      [70, 12],
      [-75, 18],
    ] as const) {
      const { x, z } = bearingXZ(b, r);
      this.spawnHumanoid(x, z, { style: 'idle', lane: 4, near: 8, far: 26 });
    }
  }

  // ---------------------------------------------------------------- shooting

  private button(b: number, down: boolean): void {
    if (this.mode !== 'play' || this.paused || !this.weapon) return;
    if (b !== 0 || !down) return;
    if (this.run !== 'running' && this.run !== 'countdown') return;
    // "High precision input": the shot resolves the instant the button goes down, using the aim at
    // that moment, not the aim at the next rendered frame.
    if (this.cooldown <= 0) {
      this.fire();
      this.cooldown = 1 / this.weapon.rate;
    }
  }

  fire(): ShotResult {
    const w = this.weapon ?? WEAPONS.pulse;
    const o = this.eye(new Vector3());
    const d = this.aimDir(new Vector3());
    const hit = this.castRay(o, d, 250);
    const point = o.clone().addScaledVector(d, Math.min(hit.t, 250));
    const muzzle = Viewmodel.muzzleOffset.clone().applyQuaternion(this.engine.camera.quaternion).add(o);
    this.fx.tracer(muzzle, point, w.auto ? 0.01 : 0.016);
    this.vm.kick(w.auto ? 0.45 : 1);
    this.audio.shot(w.auto);
    this.heat = Math.min(1.5, this.heat + (w.auto ? 0.12 : 0.5));

    let kill = false;
    if (hit.figure && this.run === 'running' && (this.drill?.damageEnabled() ?? true)) {
      const f = hit.figure;
      const head = hit.part === 'head';
      kill = f.damage(head ? w.head : w.body);
      this.fx.sparks(point, head ? PALETTE.targetRim : PALETTE.signal, head ? 12 : 7);
      this.audio.hit(head);
      this.hud.hit(head, kill);
      if (kill) {
        this.fx.burst(f.kind === 'orb' ? f.position.clone() : f.aimPoint());
        this.audio.kill();
      }
    } else if (hit.figure) {
      hit.figure.pulse();
    } else if (hit.t < 250) {
      this.fx.sparks(point, PALETTE.dust, 4, 1.5);
    }
    const res: ShotResult = { figure: hit.figure, part: hit.part, point, kill, at: this.clock };
    if (this.run === 'running' && this.drill) {
      this.drill.onShot(res);
      if (kill && hit.figure) this.drill.onKill(hit.figure);
    }
    return res;
  }

  // ---------------------------------------------------------------- drills

  resetPlayer(bearing = 0): void {
    this.player.teleport(0, 0, 0);
    this.player.crouchT = 0;
    this.yaw = -bearing * DEG;
    this.pitch = 0;
  }

  startDrill(drill: Drill, onDone: (r: DrillReport) => void, opts: { countdown?: number; label?: string } = {}): void {
    if (this.drill) this.drill.teardown();
    if (this.mode === 'attract') this.clearFigures();
    this.mode = 'play';
    this.paused = false;
    this.drill = drill;
    this.onDone = onDone;
    this.weapon = drill.weapon;
    this.resetPlayer(drill.startBearing);
    this.clock = 0;
    this.cooldown = 0;
    this.hud.resetScope();
    this.hud.setHeader(drill.kicker, drill.title);
    this.hud.setStats([]);
    this.hud.setPhase('');
    drill.setup();
    this.countdown = opts.countdown ?? 3;
    this.countdownLabel = opts.label ?? '';
    this.lastCount = -1;
    this.run = 'countdown';
    this.hud.show(true);
  }

  resume(): void {
    this.paused = false;
    this.last = performance.now();
    this.onPause(false);
  }

  /** Leave play mode and go back to the idle scene. */
  exitPlay(): void {
    if (this.drill) this.drill.teardown();
    this.drill = null;
    this.onDone = null;
    this.run = 'idle';
    this.mode = 'attract';
    this.paused = false;
    this.hud.show(false);
    this.hud.message('');
    this.hud.setSample('', '');
    this.clearFigures();
    this.spawnAttractBots();
    this.input.unlock();
  }

  private finishDrill(): void {
    const drill = this.drill;
    if (!drill) return;
    this.run = 'done';
    const report = drill.report();
    drill.teardown();
    this.drill = null;
    this.hud.message('');
    const cb = this.onDone;
    this.onDone = null;
    cb?.(report);
  }

  // ---------------------------------------------------------------- loop

  start(): void {
    const tick = (now: number) => {
      const raw = Math.max(0, (now - this.last) / 1000);
      this.last = now;
      const dt = Math.min(0.05, raw);
      this.step(dt);
      this.hud.frame(dt, this.clock, raw);
      this.onFrame(dt);
      this.engine.render(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Advance the simulation without rendering (automation/tests). */
  simulate(seconds: number, h = 1 / 120): void {
    for (let t = 0; t < seconds; t += h) this.step(h);
  }

  private step(dt: number): void {
    this.time += dt;
    const cam = this.engine.camera;
    const active = this.mode === 'play' && !this.paused;

    if (active) {
      const canMove = this.drill?.allowMove ?? true;
      const i = this.input;
      this.player.step(dt, {
        forward: canMove ? i.axis('KeyS', 'KeyW') : 0,
        right: canMove ? i.axis('KeyA', 'KeyD') : 0,
        jump: canMove && i.keys.has('Space'),
        crouch: canMove && i.crouchHeld,
        yaw: this.yaw,
      });
      if (this.player.landed > 3) {
        this.vm.land(this.player.landed);
        this.audio.land();
      }

      this.cooldown -= dt;
      // Only a held trigger may bank negative cooldown; otherwise a hitch or countdown would burst-fire.
      if (!(this.run === 'running' && this.input.fireHeld && this.weapon?.auto)) this.cooldown = Math.max(0, this.cooldown);
      if (this.run === 'countdown') {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        if (n !== this.lastCount && n > 0) {
          this.lastCount = n;
          this.audio.tick();
          this.hud.message(
            `${this.countdownLabel ? `<div class="cd-label">${greek(this.countdownLabel)}</div>` : ''}<div class="cd-num">${n}</div>`,
          );
        }
        if (this.countdown <= 0) {
          this.run = 'running';
          this.hud.message('');
          this.audio.go();
          this.drill?.begin();
        }
        const d = this.drill;
        if (d) this.hud.setTimer(d.duration, d.duration);
      } else if (this.run === 'running' && this.drill) {
        this.clock += dt;
        const w = this.weapon;
        if (w?.auto && this.input.fireHeld) {
          while (this.cooldown <= 0) {
            this.fire();
            this.cooldown += 1 / w.rate;
          }
        }
        const eye = this.eye(_v);
        for (const [f, b] of this.brains) if (f.alive) b.update(dt, eye);
        const d = this.drill;
        d.elapsed += dt;
        d.update(dt);
        this.hud.setTimer(d.duration - d.elapsed, d.duration);
        if (d.done || d.elapsed >= d.duration) this.finishDrill();
      }

      cam.position.copy(this.eye(_v));
      cam.rotation.set(this.pitch, this.yaw, 0);
    } else if (this.mode === 'attract') {
      this.attractYaw -= dt * 0.055;
      cam.position.set(0, 2.25, 0);
      cam.rotation.set(-0.07, this.attractYaw, 0);
      const eye = cam.position;
      for (const b of this.brains.values()) b.update(dt, eye);
    }

    this.heat = Math.max(0, this.heat - dt * 1.6);
    for (const f of this.figures) f.update(dt, this.time, cam);
    for (const f of [...this.figures]) if (f.removable) this.removeFigure(f);
    this.fx.update(dt);
    this.vm.update(dt, this.player.horizontalSpeed, this.player.onGround, this.player.crouchT, this.heat);
    this.engine.showViewmodel = this.mode === 'play' && !!this.weapon && this.viewmodelOn;
    this.arena.update(dt, cam.position);
  }

  /** Current attract-camera bearing, for the home screen readout. */
  get cameraBearing(): number {
    const b = (-this.engine.camera.rotation.y / DEG) % 360;
    return (b + 360) % 360;
  }
}
