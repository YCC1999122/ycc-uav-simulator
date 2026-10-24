import * as THREE from 'three';

// Gradient wind + gust model
export class Wind {
  base = new THREE.Vector3(2.2, 0, 1.0); // steady wind m/s
  private gustPhase = 0;
  private gustAmp = 0;
  private gustDir = new THREE.Vector3(1, 0, 0);
  private nextGust = 4;
  private t = 0;

  update(dt: number) {
    this.t += dt;
    // schedule gust bursts
    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      this.gustAmp = 1.5 + Math.random() * 4.5;
      const a = Math.random() * Math.PI * 2;
      this.gustDir.set(Math.cos(a), 0, Math.sin(a));
      this.nextGust = 3 + Math.random() * 7;
    }
    // gust envelope: attack/decay
    this.gustPhase = Math.max(0, this.gustPhase - dt * 0.5);
    if (this.gustAmp > 0 && this.gustPhase === 0) this.gustPhase = 1.0;
  }

  // wind velocity at a point (adds turbulence that grows with altitude band)
  at(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.base);
    const env = Math.sin(this.gustPhase * Math.PI); // 0..1..0
    if (this.gustAmp > 0) {
      out.addScaledVector(this.gustDir, this.gustAmp * env * (0.6 + 0.4 * Math.sin(this.t * 7.3)));
    }
    // small-scale turbulence
    const s = 0.35 + Math.min(pos.y * 0.02, 0.5);
    out.x += Math.sin(this.t * 1.7 + pos.y * 0.15 + pos.x * 0.03) * s;
    out.y += Math.sin(this.t * 2.3 + pos.x * 0.05) * s * 0.25;
    out.z += Math.cos(this.t * 1.3 + pos.z * 0.04) * s;
    return out;
  }
}
