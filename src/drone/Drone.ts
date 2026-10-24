import * as THREE from 'three';
import { DronePhysics, DroneSpec } from './DronePhysics';
import { FlightController, Gains } from './FlightController';
import { Battery } from './Battery';
import { Sensors } from './Sensors';
import { DroneBuild } from './DroneModel';
import { Sticks } from '../core/Input';
import { Wind } from '../world/Wind';

export class Drone {
  physics: DronePhysics;
  fc: FlightController;
  battery: Battery;
  sensors: Sensors;
  model: DroneBuild;
  spec: DroneSpec;
  gains: Gains;
  fullVoltage: number;
  isMAV: boolean;
  crashed = false;
  gimbalPitch = 0; // user-controlled gimbal tilt (MAV), rad
  damageScale = 1;   // battle damage: scales effective motor thrust
  private gyroMeas = new THREE.Vector3();
  private windVec = new THREE.Vector3();

  constructor(spec: DroneSpec, gains: Gains, model: DroneBuild, cells: number, capacityMah: number, isMAV: boolean) {
    this.spec = spec;
    this.gains = gains;
    this.physics = new DronePhysics(spec);
    this.fc = new FlightController(gains);
    this.battery = new Battery(cells, capacityMah);
    this.sensors = new Sensors();
    this.model = model;
    this.isMAV = isMAV;
    this.fullVoltage = cells * 4.2;
  }

  // fixed-step simulation
  step(dt: number, sticks: Sticks, wind: Wind, groundY: number, climbCmd: number) {
    this.sensors.update(dt, this.physics.pos);
    this.sensors.readGyro(this.physics.omega, this.gyroMeas);

    const euler = this.physics.attitude;
    const { motor } = this.fc.update(
      dt, sticks, euler, this.gyroMeas,
      this.spec.hoverThrottle, climbCmd,
      this.physics.vel, this.physics.pos
    );
    this.physics.motorCmd = [...motor];

    wind.at(this.physics.pos, this.windVec);
    this.physics.step(dt, motor, this.battery.voltage * this.damageScale, this.fullVoltage, this.windVec, groundY);
    this.battery.update(dt, motor);
  }

  // per-render visual update
  syncVisual(dt: number) {
    const g = this.model.group;
    g.position.copy(this.physics.pos);
    g.quaternion.copy(this.physics.quat);

    // propellers: blades at low rpm -> blur disc at high rpm
    for (let i = 0; i < 4; i++) {
      const p = this.model.props[i];
      const w = this.physics.motorOmega[i];
      p.pivot.rotation.y += w * dt * p.spinSign;
      const blur = Math.min(Math.max((w - 350) / 700, 0), 1);
      p.blades.visible = blur < 0.98;
      (p.disc.material as THREE.MeshBasicMaterial).opacity = blur * 0.85;
      p.disc.rotation.z -= w * dt * p.spinSign * 0.15;
    }

    // MAV gimbal: counter-rotate to stabilize horizon + user pitch control
    if (this.model.gimbal) {
      const e = this.physics.attitude;
      this.model.gimbal.rotation.set(-e.x + this.gimbalPitch, 0, -e.z, 'YXZ');
    }
  }

  get speed(): number { return this.physics.vel.length(); }
  get altitudeAGL(): number { return this.physics.pos.y; }

  reset(p: THREE.Vector3, yaw = 0) {
    this.physics.reset(p, yaw);
    this.fc.reset();
    this.battery.reset();
    this.sensors.reset();
    this.crashed = false;
  }
}
