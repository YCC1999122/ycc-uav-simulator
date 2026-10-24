import * as THREE from 'three';
import { clamp, rad } from '../core/utils';
import { Sticks, Rates, applyRates } from '../core/Input';

export type FCMode = 'ANGLE' | 'ACRO';

class PID {
  private i = 0;
  private prevMeas = 0;
  private dLpf = 0;
  constructor(
    public kp: number, public ki: number, public kd: number,
    public iLimit = 0.25, public dLpfRate = 80
  ) {}
  update(setpoint: number, meas: number, dt: number): number {
    const err = setpoint - meas;
    this.i = clamp(this.i + err * dt * this.ki, -this.iLimit, this.iLimit);
    // D on measurement (avoids setpoint kick), low-passed
    const dRaw = (meas - this.prevMeas) / Math.max(dt, 1e-5);
    this.prevMeas = meas;
    const a = 1 - Math.exp(-this.dLpfRate * dt);
    this.dLpf += (dRaw - this.dLpf) * a;
    return this.kp * err + this.i - this.kd * this.dLpf;
  }
  // decay the integral — used to dump residual torque as soon as the pilot
  // centres a stick, so the aircraft stops rotating immediately
  bleedI(rate: number, dt: number) { this.i *= Math.exp(-rate * dt); }
  reset() { this.i = 0; this.dLpf = 0; }
}

export interface Gains {
  angleP: number;          // attitude -> rate gain
  rateP: THREE.Vector3;    // rate PID P (per axis)
  rateI: THREE.Vector3;
  rateD: THREE.Vector3;
  maxAngle: number;        // ANGLE mode bank/pitch limit (deg)
  rates: Rates;
  maxYawRate: number;      // deg/s
  sideslipP: number;       // rad of counter-roll per m/s of lateral drift
  turnBank: number;        // rad of bank mixed in at full yaw stick
}

export const FPV_GAINS: Gains = {
  angleP: 8.6,               // snappy attitude chase (quad bug fixed, safe now)
  rateP: new THREE.Vector3(0.11, 0.11, 0.09),
  rateI: new THREE.Vector3(0.42, 0.42, 0.36),
  rateD: new THREE.Vector3(0.0035, 0.0035, 0.0028),
  maxAngle: 40,              // ~0.84g horizontal accel at full stick
  rates: { center: 190, max: 680, expo: 0.62 },
  maxYawRate: 160,
  sideslipP: 0.055,
  turnBank: rad(9)
};

export const MAV_GAINS: Gains = {
  angleP: 7.0,
  rateP: new THREE.Vector3(0.10, 0.10, 0.08),
  rateI: new THREE.Vector3(0.30, 0.30, 0.26),
  rateD: new THREE.Vector3(0.0042, 0.0042, 0.0034),
  maxAngle: 30,
  rates: { center: 90, max: 260, expo: 0.5 },
  maxYawRate: 80,
  sideslipP: 0.09,
  turnBank: rad(7)
};

// Cascaded attitude flight controller (Betaflight-flavoured)
export class FlightController {
  mode: FCMode = 'ANGLE';
  private pidX: PID; private pidY: PID; private pidZ: PID;
  private gains: Gains;
  // position-hold outer loop (used by GCS guided mode & MAV)
  posHoldP = 2.2; posHoldD = 2.6;
  altP = 5.5; altD = 4.0;
  guidedTarget: THREE.Vector3 | null = null;
  guidedActive = false;
  altHold = false;
  private targetAlt = 0;
  climbRateMax = 3.5;
  // scratch objects for the tilt-space outer loop (no per-frame allocation)
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpE1 = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpE2 = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpV1 = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  // coordinated-turn bank, held only while yaw is actually commanded and
  // released quickly when the stick centres (otherwise the aircraft stays
  // banked for seconds decelerating residual sideslip)
  private rollCoord = 0;

  constructor(gains: Gains) {
    this.gains = gains;
    this.pidX = new PID(gains.rateP.x, gains.rateI.x, gains.rateD.x);
    this.pidY = new PID(gains.rateP.y, gains.rateI.y, gains.rateD.y);
    this.pidZ = new PID(gains.rateP.z, gains.rateI.z, gains.rateD.z);
  }

  setGains(g: Gains) {
    this.gains = g;
    this.pidX.kp = g.rateP.x; this.pidX.ki = g.rateI.x; this.pidX.kd = g.rateD.x;
    this.pidY.kp = g.rateP.y; this.pidY.ki = g.rateI.y; this.pidY.kd = g.rateD.y;
    this.pidZ.kp = g.rateP.z; this.pidZ.ki = g.rateI.z; this.pidZ.kd = g.rateD.z;
  }

  // euler: YXZ order attitude (yaw,pitch,roll in rad). gyro: measured body rates (rad/s, noisy).
  // returns normalized per-motor commands [0..1], plus desired total thrust factor
  update(
    dt: number,
    sticks: Sticks,
    euler: THREE.Euler,          // 'YXZ'
    gyro: THREE.Vector3,         // body frame, noisy
    hoverThrottle: number,
    climbCmd = 0,                // MAV self-centering throttle channel [-1,1]
    velocity?: THREE.Vector3,
    position?: THREE.Vector3
  ): { motor: [number, number, number, number]; baseThrottle: number } {
    const g = this.gains;

    // ---------- outer loop: desired body rates ----------
    let rateX = 0, rateY = 0, rateZ = 0; // desired, rad/s (body axes: x=pitch-up+, y=yaw-left+, z=roll-left+)
    const maxA = rad(g.maxAngle);

    // guided position hold converts position error into pitch/roll angle targets
    let angleX = -sticks.pitch * maxA;   // stick fwd => pitch down => euler.x negative
    let angleZ = -sticks.roll * maxA;    // stick right => roll right => euler.z negative

    if (this.guidedActive && this.guidedTarget && position && velocity) {
      const ex = this.guidedTarget.x - position.x;
      const ez = this.guidedTarget.z - position.z;
      const dist = Math.hypot(ex, ez);
      // steer toward the target first: gate the speed command by heading
      // alignment so the return leg is flown nose-first, not backwards
      const yawErrN = Math.atan2(-ex, -ez) - euler.y;
      const align = Math.max(0.08, Math.cos(Math.atan2(Math.sin(yawErrN), Math.cos(yawErrN))));
      // PD to desired horizontal velocity, world frame
      const desVx = clamp(ex * this.posHoldP, -12, 12) * align - velocity.x * 0.6;
      const desVz = clamp(ez * this.posHoldP, -12, 12) * align - velocity.z * 0.6;
      // rotate desired accel into body frame (yaw only approximation)
      const yaw = euler.y;
      const fwd = desVz * -Math.cos(yaw) - desVx * Math.sin(yaw);
      const right = desVx * Math.cos(yaw) - desVz * Math.sin(yaw);
      // pitch forward (nose down = euler.x negative) accelerates forward
      angleX = clamp(-fwd * this.posHoldD * 0.12, -maxA, maxA);
      angleZ = clamp(-right * this.posHoldD * 0.12, -maxA, maxA);
      if (dist < 0.6) { angleX *= 0.3; angleZ *= 0.3; }
    }

    if (this.mode === 'ANGLE') {
      // yaw command first (needed for turn coordination below)
      rateY = rad(applyRates(sticks.yaw, { center: g.rates.center * 0.5, max: g.maxYawRate, expo: g.rates.expo }));

      // guided/RTH: command yaw rate toward the target heading
      if (this.guidedActive && this.guidedTarget && position) {
        const exg = this.guidedTarget.x - position.x;
        const ezg = this.guidedTarget.z - position.z;
        if (Math.hypot(exg, ezg) > 4) {
          const yw = Math.atan2(-exg, -ezg) - euler.y;
          const wrapped = Math.atan2(Math.sin(yw), Math.cos(yw));
          rateY += clamp(wrapped * 2.0, -rad(70), rad(70));
        }
      }

      // active braking: when the pilot commands the opposite direction of
      // travel, briefly allow a steeper tilt so reversing feels immediate
      // instead of a multi-second coast through the old velocity vector
      if (!this.guidedActive && velocity) {
        const cy = Math.cos(euler.y), sy = Math.sin(euler.y);
        const vFwd = -(velocity.x * sy + velocity.z * cy);
        const reversing = (sticks.pitch < -0.15 && vFwd > 1.2) || (sticks.pitch > 0.15 && vFwd < -1.2);
        if (reversing) {
          const brakeMax = rad(g.maxAngle * 1.85);
          angleX = Math.sign(angleX) * Math.min(Math.abs(angleX) * 1.85, brakeMax);
        }
      }

      // turn coordination: a real quad keeps its world velocity when yawed and
      // slides sideways — cancel body-frame sideslip with roll so the flight
      // path follows the nose (steering feel), plus bank into commanded yaw.
      // The bank is only held while yaw is commanded: on release it fades in
      // ~0.12s so the aircraft snaps wings-level instead of wallowing banked
      // for seconds while residual sideslip bleeds off.
      if (velocity && !this.guidedActive) {
        const yawActive = Math.abs(sticks.yaw) > 0.06;
        let coordTarget = 0;
        if (yawActive) {
          const cy = Math.cos(euler.y), sy = Math.sin(euler.y);
          const vRight = velocity.x * cy - velocity.z * sy;   // body +right drift
          coordTarget = clamp(vRight * g.sideslipP, -maxA * 0.5, maxA * 0.5);
          coordTarget += (rateY / Math.max(rad(g.maxYawRate), 1e-3)) * g.turnBank;
          coordTarget = clamp(coordTarget, -maxA, maxA);
        }
        const tau = yawActive ? 0.25 : 0.12;   // fast release, smooth engage
        this.rollCoord += (coordTarget - this.rollCoord) * (1 - Math.exp(-dt / tau));
        angleZ = clamp(angleZ + this.rollCoord, -maxA, maxA);
        // pitch may exceed the normal limit while actively braking
        angleX = clamp(angleX, -rad(g.maxAngle * 1.85), rad(g.maxAngle * 1.85));
      } else {
        this.rollCoord *= Math.exp(-dt / 0.12);
      }

      // Attitude outer loop in tilt space — yaw-invariant, cannot couple yaw
      // rate into pitch/roll (euler-angle error feedback diverges while
      // spinning fast: coordinates race and the P loop chases itself -> flip).
      // error = body-up x desired-up, expressed in body frame.
      const q = this.tmpQ.setFromEuler(this.tmpE1.set(euler.x, euler.y, euler.z, 'YXZ'));
      const qd = this.tmpQ2.setFromEuler(this.tmpE2.set(angleX, euler.y, angleZ, 'YXZ'));
      const upCur = this.tmpV1.set(0, 1, 0).applyQuaternion(q);
      const upDes = this.tmpV2.set(0, 1, 0).applyQuaternion(qd);
      const errB = this.tmpV3.crossVectors(upCur, upDes).applyQuaternion(q.invert());
      const maxRate = rad(g.rates.max);
      rateX = clamp(g.angleP * errB.x, -maxRate, maxRate);
      rateZ = clamp(g.angleP * errB.z, -maxRate, maxRate);
    } else {
      // ACRO: sticks map directly to rates
      rateX = rad(applyRates(sticks.pitch, g.rates));
      rateZ = rad(applyRates(sticks.roll, g.rates));
      rateY = rad(applyRates(sticks.yaw, g.rates));
    }

    // ---------- inner loop: rate PID -> normalized torque ----------
    // dump yaw integral the moment the stick centres: otherwise residual
    // windup keeps rotating the airframe for a second or two after release
    if (Math.abs(sticks.yaw) < 0.06 && this.mode === 'ANGLE') this.pidY.bleedI(8, dt);
    let tx = this.pidX.update(rateX, gyro.x, dt);
    let ty = this.pidY.update(rateY, gyro.y, dt);
    let tz = this.pidZ.update(rateZ, gyro.z, dt);

    // ---------- throttle ----------
    let base: number;
    if (this.altHold && position && velocity) {
      if (Math.abs(climbCmd) > 0.05) {
        this.targetAlt = position.y; // follow pilot climb command, then hold new alt
      }
      const climbTarget = Math.abs(climbCmd) > 0.05 ? climbCmd * this.climbRateMax
        : clamp((this.targetAlt - position.y) * this.altP * 0.4, -this.climbRateMax, this.climbRateMax);
      const climbErr = climbTarget - velocity.y;
      base = clamp(hoverThrottle + climbErr * this.altD * 0.03, 0, 1);
    } else {
      base = sticks.throttle;
    }

    // tilt compensation so throttle means "vertical thrust" in ANGLE mode
    if (this.mode === 'ANGLE') {
      const tilt = Math.cos(clamp(euler.x, -1, 1)) * Math.cos(clamp(euler.z, -1, 1));
      base = clamp(base / Math.max(tilt, 0.45), 0, 1);
    }

    // near ground with low throttle: bleed integrators (real FCs do this)
    if (base < 0.04) { this.pidX.reset(); this.pidY.reset(); this.pidZ.reset(); }

    // ---------- mixer (X quad) ----------
    // FL(-,-) FR(+,-) BL(-,+) BR(+,+), yaw: FL/BR CW(+), FR/BL CCW(-)
    const m = (t: number) => clamp(t, 0, 1);
    const mix = [
      base + tx - tz + ty,  // FL
      base + tx + tz - ty,  // FR
      base - tx - tz - ty,  // BL
      base - tx + tz + ty   // BR
    ];
    // desaturation: scale down collectively if clipping
    const peak = Math.max(mix[0], mix[1], mix[2], mix[3]);
    if (peak > 1) for (let i = 0; i < 4; i++) mix[i] /= peak;
    const lo = Math.min(mix[0], mix[1], mix[2], mix[3]);
    if (lo < 0 && base > 0.02) { const lift = -lo; for (let i = 0; i < 4; i++) mix[i] = m(mix[i] + lift); }

    return { motor: [m(mix[0]), m(mix[1]), m(mix[2]), m(mix[3])], baseThrottle: base };
  }

  setGuidedTarget(p: THREE.Vector3 | null) {
    this.guidedTarget = p ? p.clone() : null;
    this.guidedActive = !!p;
    if (p) this.targetAlt = p.y;
  }

  setTargetAlt(y: number) { this.targetAlt = y; }

  reset() {
    this.pidX.reset(); this.pidY.reset(); this.pidZ.reset();
    this.guidedActive = false; this.guidedTarget = null;
  }
}
