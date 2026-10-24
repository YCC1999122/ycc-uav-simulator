import * as THREE from 'three';

// Physical specification of a quadrotor
export interface DroneSpec {
  name: string;
  mass: number;            // kg
  armLength: number;       // m, center -> motor
  maxRpm: number;          // per motor at full voltage
  kT: number;              // thrust coeff: T = kT * omega^2
  kQ: number;              // torque coeff:  Q = kQ * omega^2
  motorTau: number;        // motor spin-up time constant (s)
  inertia: THREE.Vector3;  // diagonal inertia (kg m^2)
  areaFront: number;       // m^2 drag area facing -Z
  areaSide: number;        // facing +-X
  areaTop: number;         // facing +-Y
  cd: number;
  propDiameter: number;    // m
  hoverThrottle: number;   // 0..1 approx
}

const RHO = 1.225; // air density

export class DronePhysics {
  spec: DroneSpec;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  omega = new THREE.Vector3();          // body frame rad/s
  motorOmega = [0, 0, 0, 0];            // rad/s, FL FR BL BR
  motorCmd = [0, 0, 0, 0];
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private windV = new THREE.Vector3();

  constructor(spec: DroneSpec) { this.spec = spec; }

  get maxOmega() { return this.spec.maxRpm * 2 * Math.PI / 60; }
  get attitude(): THREE.Euler { return this.euler.setFromQuaternion(this.quat, 'YXZ'); }

  reset(p: THREE.Vector3, yaw = 0) {
    this.pos.copy(p); this.vel.set(0, 0, 0);
    this.quat.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.omega.set(0, 0, 0);
    this.motorOmega = [0, 0, 0, 0];
    this.motorCmd = [0, 0, 0, 0];
  }

  // one fixed sub-step
  step(
    dt: number,
    cmd: [number, number, number, number],
    voltage: number,          // effective pack voltage
    fullVoltage: number,
    wind: THREE.Vector3,
    groundY: number
  ) {
    const s = this.spec;
    const voltScale = Math.min(voltage / fullVoltage, 1);
    const maxOm = this.maxOmega * voltScale;

    // --- motor first-order lag ---
    let sumT = 0;
    const T = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const target = cmd[i] * maxOm;
      this.motorOmega[i] += (target - this.motorOmega[i]) * (dt / s.motorTau);
      const w = this.motorOmega[i];
      T[i] = s.kT * w * w;
      sumT += T[i];
    }

    // ground effect: extra lift near ground
    const agl = this.pos.y - groundY;
    if (agl < s.propDiameter * 1.5 && agl > 0) {
      sumT *= 1 + 0.12 * (1 - agl / (s.propDiameter * 1.5));
    }

    // --- body forces & torques ---
    // thrust along body +Y
    const Fb = this.tmpV.set(0, sumT, 0);

    // torques: r x F per motor + reaction torque
    // X layout: FL(-a,-a) FR(+a,-a) BL(-a,+a) BR(+a,+a); spin: FL/BR CW(+), FR/BL CCW(-)
    const a = s.armLength * Math.SQRT1_2;
    let tauX = a * (T[0] + T[1] - T[2] - T[3]);
    let tauZ = a * (-T[0] + T[1] - T[2] + T[3]);
    let tauY = 0;
    for (let i = 0; i < 4; i++) {
      const sgn = (i === 0 || i === 3) ? 1 : -1;
      tauY += sgn * s.kQ * this.motorOmega[i] * this.motorOmega[i];
    }

    // angular damping + gyroscopic-ish stability
    const damp = 0.014;
    tauX -= this.omega.x * damp;
    tauY -= this.omega.y * damp * 0.6;
    tauZ -= this.omega.z * damp;

    // --- integrate rotation (body frame) ---
    this.omega.x += (tauX / s.inertia.x) * dt;
    this.omega.y += (tauY / s.inertia.y) * dt;
    this.omega.z += (tauZ / s.inertia.z) * dt;

    // quaternion derivative for BODY-frame rates: dq = 0.5 * q ⊗ (omega, 0)
    // (world-frame form 0.5*(omega,0)*q is wrong here and cross-couples
    // pitch/roll whenever yawing while banked -> divergence & flip)
    const q = this.quat;
    this.tmpQ.set(this.omega.x, this.omega.y, this.omega.z, 0).premultiply(q);
    q.set(
      q.x + 0.5 * this.tmpQ.x * dt,
      q.y + 0.5 * this.tmpQ.y * dt,
      q.z + 0.5 * this.tmpQ.z * dt,
      q.w + 0.5 * this.tmpQ.w * dt
    ).normalize();

    // --- world forces ---
    const Fw = Fb.clone().applyQuaternion(q);
    Fw.y -= 9.81 * s.mass;

    // aerodynamic drag in body frame (aspect-dependent)
    this.windV.copy(wind);
    const vAirW = this.tmpV2.copy(this.vel).sub(this.windV);
    const vAirB = vAirW.clone().applyQuaternion(this.tmpQ.copy(q).invert());
    const kF = 0.5 * RHO * s.cd;
    const dragB = new THREE.Vector3(
      -kF * s.areaSide * Math.abs(vAirB.x) * vAirB.x,
      -kF * s.areaTop * Math.abs(vAirB.y) * vAirB.y,
      -kF * s.areaFront * Math.abs(vAirB.z) * vAirB.z
    );
    const dragW = dragB.applyQuaternion(q);
    Fw.add(dragW);

    // --- integrate translation ---
    this.vel.addScaledVector(Fw, dt / s.mass);
    this.pos.addScaledVector(this.vel, dt);

    // --- ground contact (simple: rest on landing gear, no bounce) ---
    if (this.pos.y < groundY + 0.09) {
      this.pos.y = groundY + 0.09;
      if (this.vel.y < 0) this.vel.y = 0;
      // friction & tip-over resistance on the pad
      this.vel.x *= 0.82; this.vel.z *= 0.82;
      const e = this.attitude;
      if (Math.abs(e.x) > 1.1 || Math.abs(e.z) > 1.1) {
        // crashed upside down: settle
        this.omega.multiplyScalar(0.5);
      } else {
        // level out gently when resting
        this.omega.x *= 0.8; this.omega.z *= 0.8;
      }
    }
  }

  get thrustRatio(): number {
    let s2 = 0;
    for (const w of this.motorOmega) s2 += this.spec.kT * w * w;
    return s2 / (this.spec.mass * 9.81);
  }
}
