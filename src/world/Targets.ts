import * as THREE from 'three';
import { camo, concrete } from '../world/Textures';

export interface Target {
  group: THREE.Group;
  pos: THREE.Vector3;
  radius: number;       // hit radius
  hp: number;
  alive: boolean;
  kind: 'tank' | 'bunker' | 'radar';
  jamRadius: number;    // electromagnetic interference field radius (tanks)
  dome?: THREE.Mesh;
  turret?: THREE.Object3D;
  dish?: THREE.Object3D;
  onDestroyed?: () => void;
  mission?: boolean;      // pre-marked training objective
}

function buildTank(): THREE.Group {
  const g = new THREE.Group();
  const camoMat = new THREE.MeshStandardMaterial({ map: camo(), roughness: 0.85, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f332a, roughness: 0.9 });

  // hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.85, 6.4), camoMat);
  hull.position.y = 0.85;
  // tracks
  const trackGeo = new THREE.BoxGeometry(0.62, 0.9, 6.9);
  const tl = new THREE.Mesh(trackGeo, dark); tl.position.set(-1.95, 0.5, 0);
  const tr = new THREE.Mesh(trackGeo, dark); tr.position.set(1.95, 0.5, 0);
  // turret (group so the barrel scans with it)
  const turretG = new THREE.Group();
  turretG.position.set(0, 1.65, 0.3);
  turretG.name = 'turret';
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 0.75, 8), camoMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.3, -2.5);
  turretG.add(turret, barrel);
  // reactive armor blocks
  const eraGeo = new THREE.BoxGeometry(0.5, 0.12, 0.4);
  for (let i = 0; i < 8; i++) {
    const e = new THREE.Mesh(eraGeo, dark);
    e.position.set(-1.4 + (i % 4) * 0.95, 1.32, -1.2 + Math.floor(i / 4) * 1.1);
    g.add(e);
  }
  g.add(hull, tl, tr, turretG);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

function buildBunker(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: concrete(), color: 0x9a968c, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 6), mat);
  base.position.y = 1.1;
  base.rotation.x = 0.04;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.5, 6.8), mat);
  roof.position.y = 2.55;
  const slit = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 }));
  slit.position.set(0, 1.7, -3.02);
  // sandbags
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x94886a, roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 6), bagMat);
    bag.scale.set(1.3, 0.6, 0.9);
    const a = (i / 12) * Math.PI * 2;
    bag.position.set(Math.cos(a) * 6.5, 0.3, Math.sin(a) * 5.2);
    g.add(bag);
  }
  g.add(base, roof, slit);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

function buildRadar(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b7268, roughness: 0.8, metalness: 0.4 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 5.5), mat);
  cabin.position.y = 1.6;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 3.4, 8), mat);
  mast.position.y = 4.4;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.35, 16, 1, true), mat);
  dish.name = 'dish';
  dish.rotation.z = Math.PI / 2;
  dish.rotation.y = 0.5;
  dish.position.y = 6.2;
  g.add(cabin, mast, dish);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
  return g;
}

export class Targets {
  list: Target[] = [];
  group = new THREE.Group();

  constructor(heightAt: (x: number, z: number) => number) {
    const defs: [string, number, number, number][] = [ // kind, x, z, rotY
      ['tank', 60, 140, 0.6],
      ['tank', -110, 160, 2.4],
      ['tank', 190, -60, -1.1],
      ['tank', -60, -180, 0.2],
      ['tank', 430, 320, 1.9],
      ['tank', -480, -260, 0.9],
      ['tank', 620, -180, -0.4],
      ['tank', -300, 520, 2.8],
      ['bunker', 140, 120, 0.4],
      ['bunker', -200, -80, 1.9],
      ['bunker', 520, 460, -0.8],
      ['bunker', -550, 300, 0.3],
      ['radar', 240, 150, -0.7],
      ['radar', -260, 60, 1.2],
      ['radar', 700, 380, 2.1],
      ['radar', -680, -420, -1.5],
      // mission objective cluster, SW corner of the range
      ['tank', -700, -640, 0.5],
      ['tank', -742, -668, 2.2],
      ['bunker', -672, -700, 0.9],
    ];
    defs.forEach(([kind, x, z, r]) => {
      let g: THREE.Group;
      let radius = 3, hp = 2, jamRadius = 0, scale = 1;
      if (kind === 'tank') { g = buildTank(); scale = 1.35; radius = 4.6; hp = 2; jamRadius = 58; }
      else if (kind === 'bunker') { g = buildBunker(); scale = 1.35; radius = 6.8; hp = 4; }
      else { g = buildRadar(); scale = 1.25; radius = 3.8; hp = 1; }
      const y = heightAt(x, z);
      g.position.set(x, y, z);
      g.rotation.y = r;
      g.scale.setScalar(scale);
      this.group.add(g);

      let dome: THREE.Mesh | undefined;
      if (jamRadius > 0) {
        // tank-borne electromagnetic interference bubble (fly around it)
        dome = new THREE.Mesh(
          new THREE.SphereGeometry(jamRadius / scale, 22, 12),
          new THREE.MeshBasicMaterial({
            color: 0x69c8ff, wireframe: true, transparent: true,
            opacity: 0.05, depthWrite: false
          })
        );
        dome.position.y = 1.2;
        g.add(dome); // added after the shadow traverse so it never casts
      }

      this.list.push({
        group: g, pos: new THREE.Vector3(x, y, z), radius, hp, alive: true,
        kind: kind as Target['kind'], jamRadius,
        dome, turret: g.getObjectByName('turret') ?? undefined,
        dish: g.getObjectByName('dish') ?? undefined
      });
    });
    // training mode: the SW-corner cluster is pre-marked as mission objectives
    const corner = new THREE.Vector3(-710, 0, -665);
    [...this.list].sort((a, b) => a.pos.distanceTo(corner) - b.pos.distanceTo(corner))
      .slice(0, 3).forEach(t => (t.mission = true));
  }

  // idle life: turrets scan, radar dishes spin, jam bubbles pulse
  update(dt: number, time: number) {
    for (const t of this.list) {
      if (!t.alive) continue;
      if (t.kind === 'tank') {
        if (t.turret) t.turret.rotation.y = Math.sin(time * 0.35 + t.pos.x * 0.01) * 0.55;
        if (t.dome) {
          (t.dome.material as THREE.MeshBasicMaterial).opacity = 0.035 + 0.025 * (0.5 + 0.5 * Math.sin(time * 1.4 + t.pos.z));
        }
      } else if (t.kind === 'radar') {
        if (t.dish) t.dish.rotation.y += dt * 0.55;
      }
    }
  }

  // apply explosion damage; returns destroyed targets this blast
  damageAt(p: THREE.Vector3, radius: number, dmg: number): Target[] {
    const killed: Target[] = [];
    for (const t of this.list) {
      if (!t.alive) continue;
      if (t.pos.distanceTo(p) < radius + t.radius) {
        t.hp -= dmg;
        if (t.hp <= 0) {
          t.alive = false;
          killed.push(t);
          if (t.dome) t.dome.visible = false;
          // knock it over / blacken
          t.group.rotation.z += (Math.random() - 0.5) * 0.5;
          t.group.rotation.x += (Math.random() - 0.5) * 0.35;
          t.group.position.y -= 0.25;
          t.group.traverse(o => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.material = (m.material as THREE.Material).clone();
              ((m.material as THREE.MeshStandardMaterial).color as THREE.Color)?.multiplyScalar(0.18);
            }
          });
          t.onDestroyed?.();
        }
      }
    }
    return killed;
  }

  reset() {
    // targets are rebuilt by main on reset; nothing persistent here
  }
}
