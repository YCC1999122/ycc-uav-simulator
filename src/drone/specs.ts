import * as THREE from 'three';
import { DroneSpec } from './DronePhysics';

// 5" FPV freestyle quad — thrust:weight ~4.7:1, brutal and agile
export const FPV_SPEC: DroneSpec = {
  name: 'FPV-5',
  mass: 0.72,
  armLength: 0.113,
  maxRpm: 30000,
  kT: 1.06e-6,
  kQ: 1.06e-6 * 0.012,
  motorTau: 0.035,
  inertia: new THREE.Vector3(0.0028, 0.0045, 0.0028),
  areaFront: 0.016,
  areaSide: 0.014,
  areaTop: 0.042,
  cd: 1.32,
  propDiameter: 0.127,
  hoverThrottle: 0.41
};

// Mavic-class recon VTOL — thrust:weight ~1.95:1, stable platform
export const MAV_SPEC: DroneSpec = {
  name: 'MAV-9',
  mass: 0.92,
  armLength: 0.17,
  maxRpm: 8000,
  kT: 8.7e-6,
  kQ: 8.7e-6 * 0.011,
  motorTau: 0.06,
  inertia: new THREE.Vector3(0.0045, 0.006, 0.0045),
  areaFront: 0.022,
  areaSide: 0.024,
  areaTop: 0.056,
  cd: 1.38,
  propDiameter: 0.235,
  hoverThrottle: 0.61
};
