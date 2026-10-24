import * as THREE from 'three';
import { OU, gauss } from '../core/utils';

// Simulated noisy sensors: gyro, GPS, barometer, magnetometer
export class Sensors {
  // gyro noise applied to angular rate readings (rad/s)
  gyroNoise = 0.011;
  private gyroBias = new THREE.Vector3();
  // GPS drift (meters), 5 Hz update
  private ouX = new OU(0.12, 0.9);
  private ouZ = new OU(0.12, 0.9);
  private ouY = new OU(0.15, 0.5);
  private gpsTimer = 0;
  gpsPos = new THREE.Vector3();
  gpsSats = 14;
  gpsHdop = 0.9;
  // baro
  baroAlt = 0;

  constructor() {
    // small static gyro bias, like a real imperfect calibration
    this.gyroBias.set(gauss(0.002), gauss(0.002), gauss(0.002));
  }

  // true angular velocity (body frame) -> measured
  readGyro(trueOmega: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.set(
      trueOmega.x + this.gyroBias.x + gauss(this.gyroNoise),
      trueOmega.y + this.gyroBias.y + gauss(this.gyroNoise),
      trueOmega.z + this.gyroBias.z + gauss(this.gyroNoise)
    );
    return out;
  }

  // true world position -> GPS fix (5 Hz, drifting)
  update(dt: number, truePos: THREE.Vector3) {
    this.gpsTimer -= dt;
    if (this.gpsTimer <= 0) {
      this.gpsTimer = 0.2;
      this.gpsPos.set(
        truePos.x + this.ouX.step(0.2) + gauss(0.4),
        truePos.y + this.ouY.step(0.2) + gauss(0.25),
        truePos.z + this.ouZ.step(0.2) + gauss(0.4)
      );
      this.gpsSats = 12 + ((Math.random() * 6) | 0);
      this.gpsHdop = 0.8 + Math.random() * 0.5;
    }
    this.baroAlt = truePos.y + gauss(0.12);
  }

  reset() {
    this.gpsTimer = 0;
  }
}
