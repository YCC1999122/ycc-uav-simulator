import * as THREE from 'three';

function radialTex(inner: string, outer: string, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

let fireTex: THREE.Texture | null = null;
let smokeTex: THREE.Texture | null = null;

interface Particle {
  mesh: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  grow: number;
  fade: number;
}

interface ActiveLight { light: THREE.PointLight; life: number; maxLife: number; }
interface ActiveRing { mesh: THREE.Mesh; life: number; maxLife: number; }

// Explosion / smoke / debris visual effects
export class Effects {
  scene: THREE.Scene;
  private particles: Particle[] = [];
  private lights: ActiveLight[] = [];
  private rings: ActiveRing[] = [];
  private smokeEmitters: { pos: THREE.Vector3; life: number; color: number; rate: number; acc: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    if (!fireTex) {
      fireTex = radialTex('rgba(255,240,200,1)', 'rgba(255,90,10,0)');
      smokeTex = radialTex('rgba(120,118,112,0.55)', 'rgba(60,58,54,0)');
    }
  }

  explode(p: THREE.Vector3, power = 1) {
    // flash
    const light = new THREE.PointLight(0xffcc88, 600 * power, 40 * power, 1.8);
    light.position.copy(p).add(new THREE.Vector3(0, 1.2, 0));
    this.scene.add(light);
    this.lights.push({ light, life: 0.28, maxLife: 0.28 });

    // fireball
    const fb = new THREE.Sprite(new THREE.SpriteMaterial({
      map: fireTex!, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffe0b0
    }));
    fb.position.copy(p).add(new THREE.Vector3(0, 0.8 * power, 0));
    fb.scale.setScalar(0.5);
    this.scene.add(fb);
    this.particles.push({
      mesh: fb, vel: new THREE.Vector3(0, 2.2 * power, 0),
      life: 0.5, maxLife: 0.5, grow: 14 * power, fade: 1
    });

    // smoke cloud
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex!, transparent: true, depthWrite: false,
        color: new THREE.Color().setHSL(0.08, 0.1, 0.14 + Math.random() * 0.12)
      }));
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2 * power;
      s.position.set(p.x + Math.cos(a) * r, p.y + 0.4 + Math.random() * 0.8, p.z + Math.sin(a) * r);
      s.scale.setScalar(0.8 + Math.random() * 1.4);
      this.scene.add(s);
      this.particles.push({
        mesh: s,
        vel: new THREE.Vector3(Math.cos(a) * (1 + Math.random()), 1.5 + Math.random() * 2.4, Math.sin(a) * (1 + Math.random())),
        life: 1.6 + Math.random() * 1.6, maxLife: 2.6, grow: 3.2, fade: 0.5
      });
    }

    // dirt/debris sparks
    const sparkMat = new THREE.SpriteMaterial({ map: fireTex!, color: 0xcfae7a, depthWrite: false });
    for (let i = 0; i < 22; i++) {
      const s = new THREE.Sprite(sparkMat.clone());
      s.position.copy(p).add(new THREE.Vector3(0, 0.3, 0));
      s.scale.setScalar(0.18 + Math.random() * 0.25);
      this.scene.add(s);
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 9 * power;
      this.particles.push({
        mesh: s,
        vel: new THREE.Vector3(Math.cos(a) * v * 0.5, 3 + Math.random() * 7 * power, Math.sin(a) * v * 0.5),
        life: 0.7 + Math.random() * 0.5, maxLife: 1.2, grow: -0.1, fade: 1
      });
    }

    // ground scorch decal
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(1.6 * power, 20),
      new THREE.MeshBasicMaterial({ color: 0x0d0c0a, transparent: true, opacity: 0.75, depthWrite: false })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(p.x, p.y + 0.03, p.z);
    this.scene.add(scorch);
    setTimeout(() => { this.scene.remove(scorch); }, 45000);

    // shockwave ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 1.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xd8cfae, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, p.y + 0.15, p.z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.55, maxLife: 0.55 });
  }

  // colored marker smoke (signal marking)
  smokeMarker(p: THREE.Vector3, color = 0xff5533, duration = 60) {
    this.smokeEmitters.push({ pos: p.clone(), life: duration, color, rate: 8, acc: 0 });
  }

  update(dt: number) {
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.vel.y -= 1.2 * dt; // slight gravity on debris
      pt.mesh.position.addScaledVector(pt.vel, dt);
      const s = pt.mesh.scale.x + pt.grow * dt;
      if (s > 0.05) pt.mesh.scale.setScalar(s);
      const m = pt.mesh.material as THREE.SpriteMaterial;
      m.opacity = Math.min(1, pt.life / (pt.maxLife * pt.fade + 1e-4));
    }
    // flash lights
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      l.light.intensity *= Math.pow(0.001, dt / l.maxLife * 4);
      if (l.life <= 0) { this.scene.remove(l.light); this.lights.splice(i, 1); }
    }
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(1 + t * 26);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
      if (r.life <= 0) { this.scene.remove(r.mesh); this.rings.splice(i, 1); }
    }
    // marker smoke emitters
    for (let i = this.smokeEmitters.length - 1; i >= 0; i--) {
      const e = this.smokeEmitters[i];
      e.life -= dt;
      if (e.life <= 0) { this.smokeEmitters.splice(i, 1); continue; }
      e.acc += dt * e.rate;
      while (e.acc > 1) {
        e.acc -= 1;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: smokeTex!, transparent: true, depthWrite: false, color: e.color
        }));
        s.position.copy(e.pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5));
        s.scale.setScalar(0.5);
        this.scene.add(s);
        this.particles.push({
          mesh: s,
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6),
          life: 3.2 + Math.random() * 2, maxLife: 4.2, grow: 1.6, fade: 0.4
        });
      }
    }
  }
}
