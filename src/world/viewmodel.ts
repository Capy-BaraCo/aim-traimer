import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Scene,
} from 'three';
import { PALETTE, SUN_DIR } from './palette';

/**
 * An abstract hard-light emitter instead of a gun model: an ink chassis, bone rails and a
 * vermilion core. Spring recoil, walk bob, crouch dip and landing thump give it weight.
 */
export class Viewmodel {
  readonly root = new Group();
  private readonly rig = new Group();
  private readonly flash: Mesh;
  private readonly core: MeshBasicMaterial;
  private recoil = 0;
  private recoilV = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private dip = 0;
  private dipV = 0;
  private flashT = 1;
  private readonly base = new Vector3(0.15, -0.14, -0.44);

  constructor(scene: Scene) {
    scene.add(new HemisphereLight(new Color('#c9cbe0'), PALETTE.bone, 1.4));
    const sun = new DirectionalLight(PALETTE.sun, 2.2);
    sun.position.copy(SUN_DIR).multiplyScalar(5).add(new Vector3(1, 1, 2));
    scene.add(sun);

    const ink = new MeshStandardMaterial({ color: '#1a1814', roughness: 0.45, metalness: 0.35 });
    const bone = new MeshStandardMaterial({ color: PALETTE.bone, roughness: 0.6, metalness: 0.05 });
    this.core = new MeshBasicMaterial({ color: PALETTE.signal });

    const body = new Mesh(new BoxGeometry(0.075, 0.1, 0.46), ink);
    const top = new Mesh(new BoxGeometry(0.05, 0.022, 0.38), bone);
    top.position.set(0, 0.061, -0.02);
    const coreStrip = new Mesh(new BoxGeometry(0.078, 0.012, 0.3), this.core);
    coreStrip.position.set(0, 0.012, -0.04);
    const barrel = new Mesh(new CylinderGeometry(0.02, 0.024, 0.2, 16), ink);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.008, -0.32);
    const muzzleRing = new Mesh(new CylinderGeometry(0.03, 0.03, 0.018, 20, 1, true), this.core);
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0, 0.008, -0.42);
    const grip = new Mesh(new BoxGeometry(0.05, 0.13, 0.07), ink);
    grip.position.set(0, -0.1, 0.1);
    grip.rotation.x = -0.25;
    const fin = new Mesh(new BoxGeometry(0.008, 0.05, 0.16), bone);
    fin.position.set(0.042, 0.02, 0.05);

    this.flash = new Mesh(
      new PlaneGeometry(0.16, 0.16),
      new MeshBasicMaterial({ color: new Color('#ffcaa8'), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.flash.position.set(0, 0.008, -0.45);
    this.flash.visible = false;

    this.rig.add(body, top, coreStrip, barrel, muzzleRing, grip, fin, this.flash);
    this.rig.rotation.y = 0.05;
    this.rig.scale.setScalar(0.5);
    this.root.add(this.rig);
    this.root.position.copy(this.base);
    scene.add(this.root);
  }

  kick(strength = 1): void {
    this.recoilV += 2.6 * strength;
    this.flashT = 0;
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  land(speed: number): void {
    this.dipV -= Math.min(0.12, speed * 0.012);
  }

  update(dt: number, moveSpeed: number, onGround: boolean, crouchT: number, firingHeat: number): void {
    // Critically-damped-ish springs.
    const k = 180;
    const c = 22;
    this.recoilV += (-k * this.recoil - c * this.recoilV) * dt;
    this.recoil += this.recoilV * dt;
    this.dipV += (-140 * this.dip - 18 * this.dipV) * dt;
    this.dip += this.dipV * dt;

    const moving = onGround && moveSpeed > 0.5;
    this.bobAmt += ((moving ? Math.min(1, moveSpeed / 5.5) : 0) - this.bobAmt) * Math.min(1, dt * 10);
    this.bobPhase += dt * moveSpeed * 1.9;

    const bx = Math.cos(this.bobPhase) * 0.006 * this.bobAmt;
    const by = -Math.abs(Math.sin(this.bobPhase)) * 0.006 * this.bobAmt;
    this.root.position.set(
      this.base.x + bx,
      this.base.y + by + this.dip - crouchT * 0.012,
      this.base.z + this.recoil * 0.04,
    );
    this.root.rotation.x = this.recoil * 0.12;

    this.flashT += dt / 0.045;
    this.flash.visible = this.flashT < 1;
    (this.flash.material as MeshBasicMaterial).opacity = Math.max(0, 1 - this.flashT);
    this.flash.scale.setScalar(0.7 + Math.random() * 0.5);

    const heat = Math.min(1, firingHeat);
    this.core.color.copy(PALETTE.signal).lerp(new Color('#ffe6d2'), heat * 0.6);
  }

  /** World-space muzzle position for tracers, given the main camera. */
  static muzzleOffset = new Vector3(0.12, -0.1, -0.62);
}
