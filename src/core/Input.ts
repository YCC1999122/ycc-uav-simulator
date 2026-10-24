import { clamp } from './utils';

// RC stick set: roll/pitch/yaw in [-1,1], throttle in [0,1]
export interface Sticks { roll: number; pitch: number; yaw: number; throttle: number; }

// Radio rate profile (Betaflight "Actual" style)
export interface Rates {
  center: number;   // deg/s at stick center sensitivity
  max: number;      // deg/s at full deflection
  expo: number;     // 0..1
}

export const FPV_RATES: Rates = { center: 190, max: 680, expo: 0.62 };
export const MAV_RATES: Rates = { center: 90, max: 260, expo: 0.5 };

// Actual-style rate curve: input stick [-1,1] -> deg/s
export function applyRates(s: number, r: Rates): number {
  const x = clamp(s, -1, 1);
  const ax = Math.abs(x);
  const expo = ax * ax * ax * r.expo + ax * (1 - r.expo);
  const deg = r.center * expo + (r.max - r.center) * expo * expo;
  return Math.sign(x) * deg;
}

export class Input {
  keys = new Set<string>();
  gamepad: Gamepad | null = null;
  gamepadActive = false;
  throttleRate = 3.0;        // keyboard throttle slew (per second)
  slew = 17.0;               // virtual stick slew rate (keyboard feels near-instant)
  vr = { roll: 0, pitch: 0, yaw: 0 };   // smoothed virtual sticks
  throttle = 0;
  throttleMode: 'RATE' | 'ABS' = 'RATE'; // RATE: stick/keys change throttle; ABS: raw stick position
  selfCenterThrottle = false;            // MAV: throttle stick becomes climb-rate command
  climbCmd = 0;                          // [-1,1] when selfCenterThrottle

  // edge-triggered actions
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];

  constructor() {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('gamepadconnected', () => { this.gamepadActive = true; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadActive = false; });
  }

  wasPressed(code: string): boolean {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  padButton(i: number): boolean {
    const g = this.gamepad;
    return !!g && !!g.buttons[i] && g.buttons[i].pressed;
  }
  padPressed(i: number): boolean {
    const now = this.padButton(i);
    const was = this.padPrev[i] || false;
    this.padPrev[i] = now;
    return now && !was;
  }

  poll(dt: number): Sticks {
    // -- keyboard targets (A/D = yaw, Q/E = roll per pilot preference) --
    let tRoll = 0, tPitch = 0, tYaw = 0, tThrDelta = 0;
    const k = this.keys;
    if (k.has('KeyQ')) tRoll -= 1;
    if (k.has('KeyE')) tRoll += 1;
    if (k.has('KeyW')) tPitch += 1;
    if (k.has('KeyS')) tPitch -= 1;
    if (k.has('KeyA')) tYaw += 1;   // A = nose left (euler.y+ = yaw left)
    if (k.has('KeyD')) tYaw -= 1;   // D = nose right
    if (k.has('ShiftLeft') || k.has('ShiftRight')) tThrDelta += 1;
    if (k.has('ControlLeft') || k.has('ControlRight')) tThrDelta -= 1;

    // -- gamepad (Mode 2 standard): Ly=thr, Lx=yaw, Ry=pitch, Rx=roll --
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepad = null;
    for (const g of gps) { if (g && g.connected) { this.gamepad = g; break; } }
    if (this.gamepad) {
      const dz = (v: number) => Math.abs(v) < 0.07 ? 0 : v;
      const ax = this.gamepad.axes;
      const pRoll = dz(ax[2] ?? 0), pPitch = -dz(ax[3] ?? 0), pYaw = -dz(ax[0] ?? 0), pThr = -dz(ax[1] ?? 0);
      if (Math.abs(pRoll) + Math.abs(pPitch) + Math.abs(pYaw) + Math.abs(pThr) > 0.01) {
        tRoll = pRoll; tPitch = pPitch; tYaw = pYaw;
        tThrDelta = pThr;
        this.gamepadActive = true;
      }
      // triggers as coarse throttle for pads without sprung stick
      const rt = this.gamepad.buttons[7]?.value ?? 0;
      const lt = this.gamepad.buttons[6]?.value ?? 0;
      if (rt > 0.02 || lt > 0.02) tThrDelta = rt - lt;
    }

    // slew-limit virtual sticks so keyboard feels like physical stick travel
    const s = this.slew * dt;
    this.vr.roll += clamp(tRoll - this.vr.roll, -s, s);
    this.vr.pitch += clamp(tPitch - this.vr.pitch, -s, s);
    this.vr.yaw += clamp(tYaw - this.vr.yaw, -s, s);

    // throttle
    if (this.selfCenterThrottle) {
      // MAV: throttle channel = climb-rate command, decays to center
      this.climbCmd += clamp(tThrDelta - this.climbCmd, -s * 0.8, s * 0.8);
      if (Math.abs(tThrDelta) < 0.01) this.climbCmd *= Math.exp(-20 * dt); // snap to center on release — no climb inertia
    } else if (this.throttleMode === 'RATE') {
      this.throttle = clamp(this.throttle + tThrDelta * this.throttleRate * dt * 0.45, 0, 1);
    } else {
      this.throttle = clamp((tThrDelta + 1) / 2, 0, 1);
    }

    return {
      roll: clamp(this.vr.roll, -1, 1),
      pitch: clamp(this.vr.pitch, -1, 1),
      yaw: clamp(this.vr.yaw, -1, 1),
      throttle: clamp(this.throttle, 0, 1)
    };
  }

  resetThrottle(v = 0) { this.throttle = v; this.climbCmd = 0; }
}
