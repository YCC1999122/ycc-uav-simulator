import * as THREE from 'three';
import { clamp } from '../core/utils';

// Ground crew / sentries for the training range. They walk patrol loops and
// take inaccurate pot-shots at low-flying drones. Purely visual + light
// gameplay pressure — no ballistics, just a probability roll per shot.

interface Actor {
  group: THREE.Group;
  pos: THREE.Vector3;
  home: THREE.Vector3;
  patrolR: number;
  patrolA: number;
  speed: number;
  phase: number;
  yaw: number;
  shootT: number;
  alive: boolean;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  muzzle: THREE.Object3D;
  flash: THREE.Mesh;
}

function soldier(heightAt: (x: number, z: number) => number) {
  const g = new THREE.Group();
  const uniform = new THREE.MeshStandardMaterial({ color: 0x74825e, roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x4d5741, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb08a64, roughness: 0.75 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x3c4136, roughness: 0.85, metalness: 0.2 });

  // legs pivot at the hip so they can swing while walking
  const mkLeg = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.13, 0.92, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.9, 0.2), uniform);
    leg.position.y = -0.45;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.15, 0.3), gear);
    boot.position.set(0, -0.92, -0.04);
    pivot.add(leg, boot);
    return pivot;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.26), uniform);
  torso.position.y = 1.26;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.3), vest);
  plate.position.y = 1.3;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), skin);
  head.position.y = 1.72;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x5e6a4c, roughness: 0.85 }));
  helmet.position.y = 1.75;

  // arms + rifle, held across the chest
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.16), uniform);
  armL.position.set(-0.28, 1.25, -0.06);
  armL.rotation.x = -0.9;
  const armR = armL.clone();
  armR.position.x = 0.28;
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.78), gear);
  rifle.position.set(0.16, 1.3, -0.32);
  rifle.rotation.x = 0.12;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.34, 6), gear);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.16, 1.33, -0.72);

  // muzzle anchor for tracers + a tiny flash cube
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.16, 1.33, -0.9);
  const flash = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  flash.visible = false;
  muzzle.add(flash);

  g.add(legL, legR, torso, plate, head, helmet, armL, armR, rifle, barrel, muzzle);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { group: g, legL, legR, muzzle, flash };
}

export class Actors {
  group = new THREE.Group();
  list: Actor[] = [];
  private tracers: { line: THREE.Line; life: number }[] = [];
  private tracerGeo = new THREE.BufferGeometry();
  onHit?: (p: THREE.Vector3) => void;
  private heightAt: (x: number, z: number) => number;

  constructor(heightAt: (x: number, z: number) => number) {
    this.heightAt = heightAt;
    this.spawn();
  }

  private spawn() {
    const spots: [number, number, number][] = [ // x, z, patrolRadius
      [70, 120, 9], [95, 132, 7], [150, 110, 11], [-95, 150, 8],
      [-130, 165, 10], [200, -55, 9], [-70, -190, 7], [25, -75, 6],
      [320, 250, 12], [-330, 300, 10], [430, -160, 9], [-420, -240, 11],
      [560, 400, 10], [-560, 180, 12]
    ];
    spots.forEach(([x, z, r], i) => {
      const s = soldier(this.heightAt);
      const y = this.heightAt(x, z);
      s.group.position.set(x, y, z);
      this.group.add(s.group);
      this.list.push({
        group: s.group,
        pos: new THREE.Vector3(x, y, z),
        home: new THREE.Vector3(x, y, z),
        patrolR: r,
        patrolA: (i * 1.7) % (Math.PI * 2),
        speed: 0.55 + (i % 3) * 0.18,
        phase: Math.random() * Math.PI * 2,
        yaw: 0,
        alive: true,
        shootT: 2 + Math.random() * 6,
        legL: s.legL, legR: s.legR, muzzle: s.muzzle, flash: s.flash
      });
    });
  }

  update(dt: number, dronePos: THREE.Vector3, droneVel: THREE.Vector3) {
    // tracers fade out
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = clamp(t.life / 0.14, 0, 1);
      if (t.life <= 0) {
        this.group.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }

    const droneSpeed = droneVel.length();
    const muzzleW = new THREE.Vector3();
    for (const a of this.list) {
      if (!a.alive) continue;
      // patrol walk
      a.patrolA += (a.speed / a.patrolR) * dt;
      a.phase += dt * a.speed * 7;
      const nx = a.home.x + Math.cos(a.patrolA) * a.patrolR;
      const nz = a.home.z + Math.sin(a.patrolA) * a.patrolR;
      a.pos.set(nx, this.heightAt(nx, nz), nz);
      a.group.position.copy(a.pos);
      // face direction of travel; atan2 gives yaw where +z is the local front
      a.yaw = Math.atan2(-Math.cos(a.patrolA), Math.sin(a.patrolA));
      a.group.rotation.y = a.yaw;
      a.legL.rotation.x = Math.sin(a.phase) * 0.55;
      a.legR.rotation.x = -Math.sin(a.phase) * 0.55;

      // take a shot now and then (they hold fire near the launch pad)
      a.shootT -= dt;
      if (a.shootT <= 0) {
        a.shootT = 4 + Math.random() * 6;
        const dist = a.pos.distanceTo(dronePos);
        if (dist < 80 && dronePos.y > 3 && Math.hypot(dronePos.x, dronePos.z) > 35) {
          this.fire(a, dronePos, droneSpeed, muzzleW);
        }
      }
      // hide flash shortly after firing
      if (a.flash.visible && Math.random() < dt * 25) a.flash.visible = false;
    }
  }

  private fire(a: Actor, dronePos: THREE.Vector3, droneSpeed: number, muzzleW: THREE.Vector3) {
    a.muzzle.getWorldPosition(muzzleW);
    a.flash.visible = true;
    a.flash.rotation.set(Math.random() * 3, Math.random() * 3, 0);

    const dist = muzzleW.distanceTo(dronePos);
    // hit probability falls off with range and with how fast the drone is
    const rangeFactor = clamp(1 - dist / 80, 0, 1);
    const agility = 1 / (1 + droneSpeed / 8);
    const hitChance = clamp(0.18 * rangeFactor * agility, 0.006, 0.14);
    const hit = Math.random() < hitChance;

    const end = dronePos.clone();
    if (!hit) {
      const spread = dist * 0.09;
      end.add(new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread * 0.7,
        (Math.random() - 0.5) * spread
      ));
    }

    const geo = new THREE.BufferGeometry().setFromPoints([muzzleW.clone(), end]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffcc66, transparent: true, opacity: 0.9
    }));
    this.group.add(line);
    this.tracers.push({ line, life: 0.14 });

    if (hit) this.onHit?.(dronePos.clone());
  }

  // blast damage: soldiers caught in the radius are knocked down permanently
  damageAt(p: THREE.Vector3, radius: number): number {
    let killed = 0;
    for (const a of this.list) {
      if (!a.alive) continue;
      if (a.pos.distanceTo(p) < radius + 1.2) {
        a.alive = false;
        killed++;
        a.group.rotation.z = (Math.random() < 0.5 ? 1 : -1) * (1.25 + Math.random() * 0.35);
        a.group.position.y += 0.12;
        a.group.traverse(o => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = (m.material as THREE.Material).clone();
            ((m.material as THREE.MeshStandardMaterial).color as THREE.Color)?.multiplyScalar(0.35);
          }
        });
      }
    }
    return killed;
  }
}
