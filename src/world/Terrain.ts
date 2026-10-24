import * as THREE from 'three';
import { fbm2 } from '../core/utils';
import { grass, dirt, concrete, helipad, netting, grassBlade } from './Textures';

// Training range terrain: 2000m x 2000m, gentle hills + flat pad area
export const TERRAIN_SIZE = 2000;

export interface Collider {
  x: number; z: number;
  halfW: number; halfD: number;
  baseY: number; height: number;
  rotY: number;
  net?: boolean;
}

export class Terrain {
  mesh: THREE.Mesh;
  group = new THREE.Group();
  // solid volumes the aircraft cannot pass through (containers, walls, nets...)
  colliders: Collider[] = [];

  constructor() {
    const seg = 360;
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
    }
    geo.computeVertexNormals();

    // large-scale vertex-color variation breaks up texture tiling so the
    // ground no longer shows a visible grid/repeat pattern
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const cx = pos.getX(i), cz = pos.getZ(i);
      const v = 0.95 + fbm2(cx * 0.0016 + 7, cz * 0.0016, 3) * 0.30;   // broad brightness
      const w = 0.88 + fbm2(cx * 0.006 + 31, cz * 0.006, 2) * 0.22;    // meadow patchiness
      const hue = fbm2(cx * 0.0021 + 90, cz * 0.0021, 2);              // green <-> dry tan shift
      colors[i * 3]     = Math.max(0.3, Math.min(1.25, v * w * (1.0 + hue * 0.20)));
      colors[i * 3 + 1] = Math.max(0.3, Math.min(1.25, v * w * (1.0 - hue * 0.03)));
      colors[i * 3 + 2] = Math.max(0.3, Math.min(1.25, v * w * (1.0 - hue * 0.26)));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const grassTex = grass();
    grassTex.repeat.set(90, 90);
    const mat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95, metalness: 0, vertexColors: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    this.buildPad();
    this.buildBaseVehicle();
    this.buildDirtRoads();
    this.buildStructures();
    this.buildClutter();
    this.buildNets();
    this.buildGrassTufts();
  }

  heightAt(x: number, z: number): number {
    // flat training area near origin, rolling hills outside; no boundary walls —
    // range limit is enforced via link degradation, not terrain
    const r = Math.hypot(x, z);
    const flat = Math.min(Math.max((r - 28) / 60, 0), 1); // 0 near origin
    let h = fbm2(x * 0.0038, z * 0.0038, 4) * 30 * flat;   // broad rolling hills
    h += fbm2(x * 0.014 + 10, z * 0.014, 4) * 11 * flat;   // mid slopes / gullies
    h += fbm2(x * 0.05 + 40, z * 0.05, 3) * 2.2 * flat;    // fine detail
    // distinctive landmark mounds so the range has readable high ground
    const mounds: [number, number, number, number][] = [ // x, z, height, radius
      [-320, -260, 16, 95], [250, -430, 21, 115], [520, 170, 14, 85],
      [-570, 390, 18, 105], [90, 650, 15, 100], [-190, 130, 7, 50]
    ];
    for (const [mx, mz, mh, mr] of mounds) {
      const dd = ((x - mx) * (x - mx) + (z - mz) * (z - mz)) / (mr * mr);
      if (dd < 4) h += mh * Math.exp(-dd * 1.6) * flat;
    }
    // far-field gentle rise so horizon isn't razor-flat
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > TERRAIN_SIZE / 2 - 200) {
      h += (edge - (TERRAIN_SIZE / 2 - 200)) * 0.05;
    }
    return h;
  }

  private buildPad() {
    const padMat = new THREE.MeshStandardMaterial({ map: concrete(), roughness: 0.9 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.25, 28), padMat);
    pad.position.set(14, 0.125, -6);
    pad.receiveShadow = true;
    this.group.add(pad);

    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ map: helipad(), transparent: true, depthWrite: false, opacity: 0.95 })
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(14, 0.26, -6);
    this.group.add(mark);
  }

  // launch platform: armored transport truck, the drone lives on its flat deck
  private buildBaseVehicle() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a654c, roughness: 0.75, metalness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2e2f28, roughness: 0.9 });
    const deckMat = new THREE.MeshStandardMaterial({ map: concrete(), color: 0xb9b6ac, roughness: 0.9 });
    // armored cab + hood
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.7, 2.3), bodyMat);
    cab.position.set(-2.6, 1.75, 0);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 2.1), bodyMat);
    nose.position.set(-4.0, 1.35, 0);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 1.9),
      new THREE.MeshStandardMaterial({ color: 0x27394a, roughness: 0.25, metalness: 0.6 }));
    win.position.set(-1.62, 2.0, 0);
    // cargo body up to deck level + deck plate with H mark
    const bed = new THREE.Mesh(new THREE.BoxGeometry(6.0, 1.75, 2.5), bodyMat);
    bed.position.set(0.8, 1.5, 0);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.0, 0.12, 2.5), deckMat);
    deck.position.set(0.8, 2.42, 0);
    deck.receiveShadow = true;
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 1.9),
      new THREE.MeshBasicMaterial({ map: helipad(), transparent: true, depthWrite: false, opacity: 0.95 })
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0.8, 2.49, 0);
    // six wheels
    const wheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.4, 12);
    for (const [wx, wz] of [[-3.4, 1.15], [-3.4, -1.15], [-0.6, 1.15], [-0.6, -1.15], [2.6, 1.15], [2.6, -1.15]] as const) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.52, wz);
      g.add(w);
    }
    g.add(cab, nose, win, bed, deck, mark);
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
    const by = this.heightAt(0.8, 0);
    g.position.set(0, by, 0);
    this.group.add(g);
    // only the cab is solid — the flat deck is the landing spot
    this.colliders.push({ x: -2.6, z: 0, halfW: 1.6, halfD: 1.2, baseY: by, height: 2.7, rotY: 0 });
  }

  private buildDirtRoads() {
    const dirtTex = dirt();
    dirtTex.repeat.set(3, 60);
    const roadMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 });
    // roads conform to terrain height so they follow the rolling hills
    const lay = (cx: number, cz: number, len: number, wid: number, rot: number) => {
      const segs = Math.max(8, Math.floor(len / 10));
      const g = new THREE.PlaneGeometry(len, wid, segs, 1);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i), lz = p.getZ(i);
        const wx = cx + lx * cos + lz * sin;
        const wz = cz - lx * sin + lz * cos;
        p.setY(i, this.heightAt(wx, wz) + 0.07);
      }
      g.computeVertexNormals();
      const road = new THREE.Mesh(g, roadMat);
      road.receiveShadow = true;
      this.group.add(road);
    };
    lay(0, 55, 1800, 6, 0);               // main road along X
    lay(-120, 0, 1500, 5, Math.PI / 2);   // cross road
    lay(320, 300, 1200, 4, 0.62);         // diagonal track to far range
  }

  // containers, blast walls, jersey barriers — full-size so low passes read correctly
  private buildStructures() {
    const contMat = [
      new THREE.MeshStandardMaterial({ color: 0x8f4c38, roughness: 0.75, metalness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0x4d6e5c, roughness: 0.75, metalness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0x666d78, roughness: 0.75, metalness: 0.35 }),
      new THREE.MeshStandardMaterial({ color: 0x9d824e, roughness: 0.8, metalness: 0.3 })
    ];
    const contGeo = new THREE.BoxGeometry(12.2, 2.9, 2.9);
    const contPos: [number, number, number][] = [
      [46, 0, -62], [60, 0, -62], [53, 2.9, -62],
      [-88, 0, 32], [-88, 0, 35.4], [-58, 0, 92],
      [110, 0, 44], [160, 0, -92], [330, 0, 244], [-356, 0, 184],
      [524, 0, -304], [-484, 0, -354], [706, 0, 504], [-726, 0, -124]
    ];
    contPos.forEach(([x, y, z], i) => {
      const c = new THREE.Mesh(contGeo, contMat[i % 4]);
      const yy = this.heightAt(x, z) + y + 1.45;
      c.position.set(x, yy, z);
      c.rotation.y = (i * 0.37) % 1.1;
      c.castShadow = c.receiveShadow = true;
      this.group.add(c);
      this.colliders.push({
        x, z, halfW: 6.1, halfD: 1.45, baseY: this.heightAt(x, z) + y,
        height: 2.9, rotY: c.rotation.y
      });
    });

    // ruined walls / blast walls
    const wallMat = new THREE.MeshStandardMaterial({ map: concrete(), color: 0xbbb8ae, roughness: 0.95 });
    const walls: [number, number, number, number, number][] = [ // x,z,len,h,rotY
      [60, 100, 14, 3.6, 0.3], [74, 106, 10, 2.4, 1.75], [-40, -110, 18, 4.2, 0],
      [-32, -100, 8, 2.8, 1.57], [184, 60, 16, 4.6, 0.8], [-164, -40, 20, 3.4, 1.2],
      [420, -180, 18, 4.4, 0.5], [-380, 320, 22, 5.0, 1.1], [650, 220, 16, 3.8, 2.0],
      [-600, -480, 20, 4.2, 0.9]
    ];
    walls.forEach(([x, z, w, h, r]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.6), wallMat);
      const by = this.heightAt(x, z);
      wall.position.set(x, by + h / 2, z);
      wall.rotation.y = r;
      wall.castShadow = wall.receiveShadow = true;
      this.group.add(wall);
      this.colliders.push({ x, z, halfW: w / 2, halfD: 0.3, baseY: by, height: h, rotY: r });
    });

    // jersey barriers lining the main road
    const barrierMat = new THREE.MeshStandardMaterial({ map: concrete(), color: 0xa9a69c, roughness: 0.95 });
    const barrierGeo = new THREE.BoxGeometry(3.2, 1.1, 0.7);
    const barrierPos: [number, number, number][] = [
      [100, 51, 0], [108, 51, 0], [116, 51, 0.05], [-60, 52, 0],
      [-52, 52, 0], [240, 300, 1.57], [250, 292, 1.57], [520, -260, 0.4]
    ];
    barrierPos.forEach(([x, z, r]) => {
      const b = new THREE.Mesh(barrierGeo, barrierMat);
      const by = this.heightAt(x, z);
      b.position.set(x, by + 0.55, z);
      b.rotation.y = r;
      b.castShadow = b.receiveShadow = true;
      this.group.add(b);
      this.colliders.push({ x, z, halfW: 1.6, halfD: 0.35, baseY: by, height: 1.1, rotY: r });
    });
  }

  // oil drums, crates, sandbag emplacements, wrecks, dugout bunker
  private buildClutter() {
    // tire stacks
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x242428, roughness: 0.95 });
    const tireGeo = new THREE.TorusGeometry(0.42, 0.19, 8, 18);
    const tireStacks: [number, number][] = [[15, -20], [17, -22], [16, -18.5], [-30, 40], [90, -30], [310, 235], [-345, 175], [190, 90]];
    tireStacks.forEach(([x, z]) => {
      const n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const t = new THREE.Mesh(tireGeo, tireMat);
        t.rotation.x = Math.PI / 2;
        t.position.set(
          x + (Math.random() - 0.5) * 0.3,
          this.heightAt(x, z) + 0.2 + i * 0.36,
          z + (Math.random() - 0.5) * 0.3
        );
        t.castShadow = t.receiveShadow = true;
        this.group.add(t);
      }
    });

    // 200L oil drums (0.6m dia, 0.88m tall) — clusters near the containers
    const drumMats = [
      new THREE.MeshStandardMaterial({ color: 0x807c4a, roughness: 0.7, metalness: 0.45 }),
      new THREE.MeshStandardMaterial({ color: 0x9c4c36, roughness: 0.8, metalness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0x4f7089, roughness: 0.7, metalness: 0.45 })
    ];
    const drumGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.88, 12);
    const drumClusters: [number, number, number][] = [
      [40, -70, 7], [-84, 26, 6], [120, 50, 8], [-70, 96, 5],
      [320, 250, 9], [-350, 190, 6], [520, -310, 6], [210, 84, 7], [-200, -70, 8]
    ];
    drumClusters.forEach(([cx, cz, n], i) => {
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(drumGeo, drumMats[(i + k) % 3]);
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 3.2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        m.position.set(x, this.heightAt(x, z) + 0.44, z);
        m.rotation.y = Math.random() * 3;
        if (Math.random() < 0.18) m.rotation.z = Math.PI / 2;
        m.castShadow = m.receiveShadow = true;
        this.group.add(m);
      }
    });

    // wooden supply crates (1.2m)
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x937852, roughness: 0.95 });
    const crateGeo = new THREE.BoxGeometry(1.2, 1, 1.2);
    const crateSpots: [number, number][] = [
      [52, -70], [54, -72], [53, -70], [126, 52], [-66, 98], [330, 252],
      [-344, 192], [214, 86], [-196, -72], [560, 402], [-566, 184]
    ];
    crateSpots.forEach(([x, z], i) => {
      const c = new THREE.Mesh(crateGeo, crateMat);
      const h = this.heightAt(x, z) + 0.5 + (i % 2) * 0.98;
      c.position.set(x, h, z);
      c.rotation.y = (i * 0.9) % 1.4;
      c.castShadow = c.receiveShadow = true;
      this.group.add(c);
    });

    // sandbag emplacements (u-shaped, around the defensive line)
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x94886a, roughness: 1 });
    const bagGeo = new THREE.SphereGeometry(0.42, 8, 6);
    const bagSpots: [number, number, number][] = [
      [70, 118, 0.4], [150, 108, 1.2], [-132, 162, 2.2], [204, -58, 0.8],
      [-72, -188, 1.7], [322, 248, 2.8], [-332, 296, 0.2]
    ];
    bagSpots.forEach(([x, z, rot]) => {
      // three-row horseshoe: 2 high at the back, 1 high at the wings
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 9; i++) {
          const a = -1.1 + (i / 8) * 2.2;
          const r = 3.4 - row * 0.25;
          const bx = x + Math.cos(a + rot) * r;
          const bz = z + Math.sin(a + rot) * r;
          const bag = new THREE.Mesh(bagGeo, bagMat);
          bag.scale.set(1.35, 0.66, 0.95);
          bag.position.set(bx, this.heightAt(bx, bz) + 0.28 + row * 0.32, bz);
          bag.rotation.y = a + rot;
          bag.castShadow = bag.receiveShadow = true;
          this.group.add(bag);
        }
      }
    });

    // wrecked soft-skin vehicles
    const wreckMat = new THREE.MeshStandardMaterial({ color: 0x43403a, roughness: 0.95, metalness: 0.2 });
    const wrecks: [number, number, number][] = [
      [96, 58, 0.5], [-150, 70, 2.1], [286, 214, 1.1], [-420, 300, 0.3], [610, 180, 2.5], [-620, -300, 1.8]
    ];
    wrecks.forEach(([x, z, r]) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 2), wreckMat);
      body.position.y = 0.85;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.9), wreckMat);
      cab.position.set(-0.6, 1.75, 0);
      const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.28, 10);
      for (const [wx, wz] of [[-1.4, 1], [-1.4, -1], [1.4, 1], [1.4, -1]]) {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.rotation.x = Math.PI / 2;
        w.position.set(wx, 0.45, wz);
        g.add(w);
      }
      g.add(body, cab);
      const by = this.heightAt(x, z);
      g.position.set(x, by, z);
      g.rotation.set(0.06, r, 0.08);
      g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
      this.group.add(g);
      this.colliders.push({ x, z, halfW: 2.3, halfD: 1.1, baseY: by, height: 2.2, rotY: r });
    });

    // sunken dugout / bunker entrance with earth berm (low, hidden from above)
    const dugoutMat = new THREE.MeshStandardMaterial({ map: concrete(), color: 0x9c988e, roughness: 1 });
    const earthMat = new THREE.MeshStandardMaterial({ color: 0x7d6b4c, roughness: 1 });
    const dugouts: [number, number, number][] = [[-250, 130, 0.7], [420, 430, 2.3], [-520, -180, 1.1]];
    dugouts.forEach(([x, z, r]) => {
      const g = new THREE.Group();
      // U-shaped earth berm
      const bermGeo = new THREE.BoxGeometry(9, 1.8, 2.4);
      for (const [ox, oz, ry] of [[0, -4, 0], [-4.2, 0, Math.PI / 2], [4.2, 0, Math.PI / 2]]) {
        const b = new THREE.Mesh(bermGeo, earthMat);
        b.position.set(ox, 0.9, oz);
        b.rotation.y = ry;
        g.add(b);
      }
      // concrete entrance sunk into the ground
      const portal = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 1.2), dugoutMat);
      portal.position.set(0, -0.7, -4.2);
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.9, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x07090a, roughness: 1 }));
      mouth.position.set(0, -0.85, -3.6);
      g.add(portal, mouth);
      const by = this.heightAt(x, z);
      g.position.set(x, by, z);
      g.rotation.y = r;
      g.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.receiveShadow = true; } });
      this.group.add(g);
      this.colliders.push({ x, z, halfW: 4.5, halfD: 5, baseY: by, height: 1.8, rotY: r });
    });

    this.buildTrees();

    // perimeter fence poles
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 3, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555a50, roughness: 0.8 });
    const poleCount = 160;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, poleCount);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < poleCount; i++) {
      const t = i / poleCount * Math.PI * 2;
      const x = Math.cos(t) * (TERRAIN_SIZE / 2 - 24);
      const z = Math.sin(t) * (TERRAIN_SIZE / 2 - 24);
      m4.makeTranslation(x, this.heightAt(x, z) + 1.5, z);
      poles.setMatrixAt(i, m4);
    }
    poles.castShadow = true;
    this.group.add(poles);
  }

  // 12m interception screens — tall enough to block a low-flying quad,
  // so the pilot has to route around them
  private buildNets() {
    const defs: [number, number, number, number, number][] = [ // x,z,len,h,rotY
      [130, 62, 46, 12, 0.5],
      [300, 372, 58, 12, -0.35],
      [-500, 196, 52, 12, 1.15],
      [618, -178, 48, 12, 0.9]
    ];
    const postMat = new THREE.MeshStandardMaterial({ color: 0x585c52, roughness: 0.7, metalness: 0.5 });
    const postGeo = new THREE.CylinderGeometry(0.16, 0.2, 12.4, 8);
    const netTex = netting();
    defs.forEach(([x, z, len, h, rotY]) => {
      const g = new THREE.Group();
      const by = this.heightAt(x, z);
      const panelMat = new THREE.MeshStandardMaterial({
        map: netTex.clone(), transparent: true, alphaTest: 0.25, side: THREE.DoubleSide,
        color: 0xa8b09a, roughness: 0.9, metalness: 0.1, depthWrite: false
      });
      (panelMat.map as THREE.CanvasTexture).repeat.set(len / 3, h / 3);
      (panelMat.map as THREE.CanvasTexture).needsUpdate = true;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, h), panelMat);
      panel.position.y = h / 2 + 0.4;
      // alpha-tested texture would cast a solid rectangle, so only posts do
      // camo scrim hanging over the top third
      const scrim = new THREE.Mesh(
        new THREE.PlaneGeometry(len, h * 0.42),
        new THREE.MeshStandardMaterial({ color: 0x4d5540, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
      );
      scrim.position.set(0, h * 0.79, 0.05);
      g.add(panel, scrim);
      for (const off of [-len / 2, len / 2]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(off, 6.2, 0);
        post.castShadow = true;
        g.add(post);
      }
      g.position.set(x, by, z);
      g.rotation.y = rotY;
      this.group.add(g);
      this.colliders.push({
        x, z, halfW: len / 2, halfD: 0.12, baseY: by, height: h, rotY, net: true
      });
    });
  }

  private buildTrees() {
    // two-species forest: 3-tier pines + irregular broadleaf canopies,
    // per-instance colour variation so no two trees look identical
    const N = 560;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 3.6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a543a, roughness: 1 });
    const pineGeo = [
      new THREE.ConeGeometry(2.3, 2.8, 8),
      new THREE.ConeGeometry(1.75, 2.5, 8),
      new THREE.ConeGeometry(1.1, 2.1, 8)
    ];
    // broadleaf canopy: icosahedron with deterministic vertex jitter
    const leafGeo = new THREE.IcosahedronGeometry(2.0, 1);
    {
      const lp = leafGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < lp.count; i++) {
        v.fromBufferAttribute(lp, i);
        const k = 1 + (Math.sin(v.x * 12.9 + v.y * 7.7 + v.z * 4.3) * 0.5
                     + Math.sin(v.z * 9.1 + v.x * 3.3) * 0.5) * 0.17;
        v.multiplyScalar(k);
        lp.setXYZ(i, v.x, v.y * 0.8, v.z);
      }
      leafGeo.computeVertexNormals();
    }
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    const pineT = pineGeo.map(g => new THREE.InstancedMesh(g, pineMat, N));
    const blobs = new THREE.InstancedMesh(leafGeo, leafMat, N * 3);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let placed = 0, pines = 0, blobCount = 0, tries = 0;
    while (placed < N && tries < N * 8) {
      tries++;
      const x = (Math.random() - 0.5) * (TERRAIN_SIZE - 80);
      const z = (Math.random() - 0.5) * (TERRAIN_SIZE - 80);
      if (Math.hypot(x, z) < 55) continue;                     // keep pad area clear
      if (Math.abs(z - 55) < 8 && Math.abs(x) < 900) continue; // keep roads clear
      if (Math.abs(x + 120) < 7 && Math.abs(z) < 760) continue;
      const y = this.heightAt(x, z);
      const s = 0.9 + Math.random() * 1.3;
      const yaw = Math.random() * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      m4.makeRotationFromQuaternion(q).scale(new THREE.Vector3(s, s, s)).setPosition(x, y + 1.8 * s, z);
      trunks.setMatrixAt(placed, m4);
      if (Math.random() < 0.55) {
        // pine: three stacked tiers
        const tierY = [3.4, 5.1, 6.6];
        for (let t = 0; t < 3; t++) {
          m4.makeRotationFromQuaternion(q).scale(new THREE.Vector3(s, s, s))
            .setPosition(x, y + tierY[t] * s, z);
          pineT[t].setMatrixAt(pines, m4);
          col.setHSL(0.30 + Math.random() * 0.05, 0.42 + Math.random() * 0.15, 0.30 + t * 0.045 + Math.random() * 0.05);
          pineT[t].setColorAt(pines, col);
        }
        pines++;
      } else {
        // broadleaf: three offset jittered blobs
        for (let b = 0; b < 3; b++) {
          const bs = s * (0.75 + Math.random() * 0.4);
          const ox = (Math.random() - 0.5) * 1.6 * s;
          const oz = (Math.random() - 0.5) * 1.6 * s;
          const oy = y + (4.0 + b * 0.9 + Math.random() * 0.5) * s;
          m4.makeRotationFromQuaternion(q).scale(new THREE.Vector3(bs, bs * 0.85, bs))
            .setPosition(x + ox, oy, z + oz);
          blobs.setMatrixAt(blobCount, m4);
          col.setHSL(0.24 + Math.random() * 0.09, 0.45 + Math.random() * 0.2, 0.34 + Math.random() * 0.12);
          blobs.setColorAt(blobCount, col);
          blobCount++;
        }
      }
      placed++;
    }
    trunks.count = placed;
    pineT.forEach(p => { p.count = pines; p.castShadow = true; this.group.add(p); });
    blobs.count = blobCount;
    trunks.castShadow = blobs.castShadow = true;
    this.group.add(trunks, blobs);
  }

  // instanced 3D grass tufts near the flight area — real blades instead of
  // flat texture when hugging the ground
  private buildGrassTufts() {
    const tex = grassBlade();
    const geo = new THREE.PlaneGeometry(1.0, 0.62);
    geo.translate(0, 0.31, 0);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1, metalness: 0
    });
    const M = 3200;
    const tuftsA = new THREE.InstancedMesh(geo, mat, M);
    const tuftsB = new THREE.InstancedMesh(geo, mat, M);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0, tries = 0;
    while (n < M && tries < M * 6) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.sqrt(Math.random()) * 150;      // dense near pad, out to ~160m
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(z - 55) < 3.5 && Math.abs(x) < 900) continue; // off the road
      if (Math.hypot(x, z) < 8.5) continue;                      // off the pad
      const y = this.heightAt(x, z);
      const s = 0.7 + Math.random() * 0.9;
      const yaw = Math.random() * Math.PI;
      q.setFromAxisAngle(up, yaw);
      m4.makeRotationFromQuaternion(q).scale(new THREE.Vector3(s, s, s)).setPosition(x, y - 0.02, z);
      tuftsA.setMatrixAt(n, m4);
      q.setFromAxisAngle(up, yaw + Math.PI / 2);
      m4.makeRotationFromQuaternion(q).scale(new THREE.Vector3(s, s, s)).setPosition(x, y - 0.02, z);
      tuftsB.setMatrixAt(n, m4);
      n++;
    }
    tuftsA.count = tuftsB.count = n;
    this.group.add(tuftsA, tuftsB);
  }

  // resolve the aircraft against solid volumes; mutates pos/vel.
  // returns the collider that was hit (null when clear)
  collide(pos: THREE.Vector3, vel: THREE.Vector3): Collider | null {
    for (const c of this.colliders) {
      if (pos.y > c.baseY + c.height + 0.7 || pos.y < c.baseY - 0.7) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      if (Math.abs(dx) > c.halfW + c.halfD + 5 || Math.abs(dz) > c.halfW + c.halfD + 5) continue;
      const cos = Math.cos(c.rotY), sin = Math.sin(c.rotY);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const mx = c.halfW + 0.55, mz = c.halfD + 0.55;
      if (Math.abs(lx) >= mx || Math.abs(lz) >= mz) continue;

      // resolve along the shallowest local axis
      const penX = mx - Math.abs(lx);
      const penZ = mz - Math.abs(lz);
      let nlx = 0, nlz = 0;
      if (penX < penZ) nlx = Math.sign(lx) || 1;
      else nlz = Math.sign(lz) || 1;
      const nx = nlx * cos + nlz * sin;
      const nz = -nlx * sin + nlz * cos;
      const pen = Math.min(penX, penZ);
      pos.x += nx * pen; pos.z += nz * pen;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) { vel.x -= vn * nx * 1.4; vel.z -= vn * nz * 1.4; }
      vel.x *= 0.45; vel.z *= 0.45;
      return c;
    }
    return null;
  }

  // shaded-relief basemap for the GCS map (drawn once at startup)
  buildBasemap(size = 1024): HTMLCanvasElement {
    const N = 257;
    const S = TERRAIN_SIZE;
    const hs = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const z = -S / 2 + (j / (N - 1)) * S;
      for (let i = 0; i < N; i++) {
        const x = -S / 2 + (i / (N - 1)) * S;
        hs[j * N + i] = this.heightAt(x, z);
      }
    }
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const cell = S / (N - 1);
    for (let py = 0; py < size; py++) {
      const v = py / (size - 1) * (N - 1);
      const j = Math.min(Math.floor(v), N - 2);
      const fz = v - j;
      for (let px = 0; px < size; px++) {
        const u = px / (size - 1) * (N - 1);
        const i = Math.min(Math.floor(u), N - 2);
        const fx = u - i;
        const h00 = hs[j * N + i], h10 = hs[j * N + i + 1];
        const h01 = hs[(j + 1) * N + i], h11 = hs[(j + 1) * N + i + 1];
        const h = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
        const gx = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / cell;
        const gz = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / cell;
        // proper hillshade: surface normal vs a NW light
        const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
        const nx = -gx * inv, ny = inv, nz = -gz * inv;
        const lam = nx * -0.53 + ny * 0.72 + nz * -0.45;
        const shade = Math.max(0.38, Math.min(1.45, 0.62 + lam * 0.82));

        // elevation tint: dark olive low ground -> dry tan high ground
        const t = Math.max(0, Math.min(1, (h + 6) / 52));
        let r = 74 + t * 72;
        let g = 88 + t * 44;
        let b = 52 + t * 44;

        // dirt roads
        const wx = (px / (size - 1)) * S - S / 2;
        const wz = (py / (size - 1)) * S - S / 2;
        const onRoad = Math.abs(wz - 55) < 3.2 || Math.abs(wx + 120) < 2.8;
        const diag = Math.abs((wz - 300) - (wx - 320) * Math.tan(0.62)) < 2.4 && Math.abs(wx - 320) < 560;
        if (onRoad || diag) {
          r = 108; g = 94; b = 72;
        }
        // helipad
        if (Math.hypot(wx, wz) < 7) { r = 150; g = 152; b = 146; }

        const k = (j * 92821 + i * 68917) % 997;
        const n = (k / 997 - 0.5) * 10;
        const o = (py * size + px) * 4;
        d[o] = Math.max(0, Math.min(255, r * shade + n));
        d[o + 1] = Math.max(0, Math.min(255, g * shade + n));
        d[o + 2] = Math.max(0, Math.min(255, b * shade + n));
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}
