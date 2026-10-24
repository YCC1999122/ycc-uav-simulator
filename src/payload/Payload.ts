import * as THREE from 'three';
import { Effects } from './Effects';
import { Targets } from '../world/Targets';
import { Wind } from '../world/Wind';

export type PayloadKind = 'vog' | 'bomb' | 'marker' | 'grenade';

interface Round {
  kind: PayloadKind;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  live: boolean;
}

const KIND_PROPS: Record<PayloadKind, { mass: number; radius: number; dmg: number; power: number; color: number; size: [number, number] }> = {
  vog:    { mass: 0.35, radius: 5,  dmg: 2, power: 1.0, color: 0x3a4438, size: [0.05, 0.16] },
  bomb:   { mass: 1.4,  radius: 8,  dmg: 4, power: 2.2, color: 0x2c2f26, size: [0.08, 0.34] },
  marker: { mass: 0.3,  radius: 0,  dmg: 0, power: 0,   color: 0xbb3322, size: [0.05, 0.18] },
  grenade:{ mass: 0.4,  radius: 6,  dmg: 2, power: 1.4, color: 0x3c3428, size: [0.05, 0.2]  }
};

// carriage + release + ballistic flight + impact
export class Payload {
  capacity: Record<PayloadKind, number>;
  load: Record<PayloadKind, number>;
  infinite = true; // training range: unlimited reloads
  private rack: THREE.Group;
  private rackMeshes: THREE.Mesh[] = [];
  private rounds: Round[] = [];
  private effects: Effects;
  private targets: Targets;
  private wind: Wind;
  private heightAt: (x: number, z: number) => number;
  private scene: THREE.Scene;
  onImpact?: (kind: PayloadKind, pos: THREE.Vector3, killed: number) => void;
  // ground troops also take blast damage (structural type to avoid an import cycle)
  actors?: { damageAt(p: THREE.Vector3, radius: number): number };

  constructor(
    scene: THREE.Scene, rackParent: THREE.Object3D,
    load: Partial<Record<PayloadKind, number>>,
    effects: Effects, targets: Targets, wind: Wind,
    heightAt: (x: number, z: number) => number
  ) {
    this.scene = scene;
    this.rack = new THREE.Group();
    rackParent.add(this.rack);
    this.effects = effects;
    this.targets = targets;
    this.wind = wind;
    this.heightAt = heightAt;
    this.load = { vog: 0, bomb: 0, marker: 0, grenade: 0, ...load };
    this.capacity = { ...this.load };
    this.rebuildRack();
  }

  private rebuildRack() {
    for (const m of this.rackMeshes) this.rack.remove(m);
    this.rackMeshes = [];
    let slot = 0;
    (Object.keys(this.load) as PayloadKind[]).forEach(kind => {
      for (let i = 0; i < this.load[kind]; i++) {
        const p = KIND_PROPS[kind];
        const m = new THREE.Mesh(
          new THREE.CapsuleGeometry(p.size[0], p.size[1], 4, 8),
          new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5, metalness: 0.4 })
        );
        m.rotation.z = Math.PI / 2 * 0; // hang vertical
        const x = (slot - 1.5) * 0.09;
        m.position.set(x, -0.08, 0);
        // small tail fins
        const fin = new THREE.Mesh(
          new THREE.BoxGeometry(0.005, p.size[1] * 0.5, p.size[0] * 1.8),
          new THREE.MeshStandardMaterial({ color: 0x555c50, roughness: 0.6 })
        );
        fin.position.set(0, p.size[1] * 0.5, 0);
        m.add(fin);
        m.userData.kind = kind;
        // layer 1: carried ordnance — hidden from the belly camera so it
        // doesn't block the downward view, still visible in chase view
        m.traverse(o => o.layers.set(1));
        this.rack.add(m);
        this.rackMeshes.push(m);
        slot++;
      }
    });
  }

  totalAmmo(): number { return this.infinite ? Infinity : this.load.vog + this.load.bomb + this.load.marker; }

  // release one round of kind; inherits drone velocity
  drop(kind: PayloadKind, dronePos: THREE.Vector3, droneQuat: THREE.Quaternion, droneVel: THREE.Vector3): boolean {
    if (!this.infinite && this.load[kind] <= 0) return false;
    if (!this.infinite) this.load[kind]--;

    const p = KIND_PROPS[kind];
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(p.size[0], p.size[1], 4, 8),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5, metalness: 0.4 })
    );
    // release point: under belly, world space
    const offset = new THREE.Vector3(0, -0.12, 0).applyQuaternion(droneQuat);
    const pos = dronePos.clone().add(offset);
    mesh.position.copy(pos);
    mesh.quaternion.copy(droneQuat);
    this.scene.add(mesh);

    const vel = droneVel.clone();
    // gentle release kick downward
    vel.y -= 0.4;

    this.rounds.push({ kind, mesh, pos, vel, live: true });
    this.rebuildRack();
    return true;
  }

  // main armament: launch a small grenade along the given direction (mouse fire)
  fireGrenade(pos: THREE.Vector3, dir: THREE.Vector3, droneVel: THREE.Vector3): boolean {
    const p = KIND_PROPS.grenade;
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(p.size[0], p.size[1], 4, 8),
      new THREE.MeshStandardMaterial({
        color: p.color, roughness: 0.35, metalness: 0.55,
        emissive: 0xff7733, emissiveIntensity: 0.3
      })
    );
    const spawn = pos.clone().addScaledVector(dir, 0.7);
    spawn.y -= 0.1;
    mesh.position.copy(spawn);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(36).add(droneVel);
    this.rounds.push({ kind: 'grenade', mesh, pos: spawn, vel, live: true });
    return true;
  }

  // ballistic impact prediction from current state (for GCS drop-point marker)
  predictImpact(pos: THREE.Vector3, vel: THREE.Vector3): THREE.Vector3 {
    const p = pos.clone();
    const v = vel.clone();
    const dt = 0.05;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < 200; i++) {
      this.wind.at(p, tmp);
      const drag = tmp.copy(v).sub(tmp).multiplyScalar(-0.12);
      v.addScaledVector(drag, dt);
      v.y -= 9.81 * dt;
      p.addScaledVector(v, dt);
      if (p.y <= this.heightAt(p.x, p.z)) break;
    }
    p.y = this.heightAt(p.x, p.z);
    return p;
  }

  update(dt: number) {
    const wv = new THREE.Vector3();
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      if (!r.live) continue;
      const p = KIND_PROPS[r.kind];
      this.wind.at(r.pos, wv);
      // drag
      const drag = wv.copy(r.vel).sub(wv).multiplyScalar(-0.12 / p.mass);
      r.vel.addScaledVector(drag, dt);
      r.vel.y -= 9.81 * dt;
      r.pos.addScaledVector(r.vel, dt);
      // orient along velocity
      if (r.vel.lengthSq() > 1) {
        const target = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), r.vel.clone().normalize().negate()
        );
        r.mesh.quaternion.slerp(target, 0.2);
      }
      r.mesh.position.copy(r.pos);

      const groundY = this.heightAt(r.pos.x, r.pos.z);
      // proximity fuse: grenades detonate on direct contact with a target
      let touchedTarget = false;
      if (r.kind === 'grenade') {
        for (const t of this.targets.list) {
          if (!t.alive) continue;
          if (t.pos.distanceToSquared(r.pos) < (t.radius + 0.6) * (t.radius + 0.6)) { touchedTarget = true; break; }
        }
      }
      if (touchedTarget || r.pos.y <= groundY + 0.05) {
        r.pos.y = groundY;
        r.live = false;
        this.scene.remove(r.mesh);

        const impact = r.pos.clone();
        if (r.kind === 'marker') {
          this.effects.smokeMarker(impact, 0xff5533, 60);
          this.onImpact?.(r.kind, impact, 0);
        } else {
          this.effects.explode(impact, p.power);
          const killed = this.targets.damageAt(impact, p.radius, p.dmg);
          const actorsKilled = this.actors?.damageAt(impact, p.radius) ?? 0;
          // secondary fireball if target destroyed
          for (const t of this.targets.list) {
            if (!t.alive && t.pos.distanceTo(impact) < p.radius + t.radius) {
              this.effects.explode(t.pos.clone().add(new THREE.Vector3(0, 1, 0)), p.power * 1.6);
              this.effects.smokeMarker(t.pos.clone(), 0x222222, 40);
            }
          }
          this.onImpact?.(r.kind, impact, killed.length + actorsKilled);
        }
        this.rounds.splice(i, 1);
      }
    }
  }
}
