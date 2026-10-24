import * as THREE from 'three';
import { Drone } from '../drone/Drone';
import { Targets } from '../world/Targets';
import { Geo } from '../core/Geo';
import { TERRAIN_SIZE } from '../world/Terrain';

export type GCSMode = 'hidden' | 'mini' | 'full';

// 2D tactical map: grid, targets, track, drop prediction, click-to-guide
export class GCSMap {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label = document.getElementById('gcs-label') as HTMLElement;
  mode: GCSMode = 'hidden';
  private geo: Geo;
  private trail: THREE.Vector2[] = [];
  private trailTimer = 0;
  guidePoint: THREE.Vector3 | null = null;
  dropPrediction: THREE.Vector3 | null = null;
  home = new THREE.Vector3(0, 0, 0);
  jamZones: { x: number; z: number; r: number }[] = [];
  // player-placed target markers (map never shows real targets automatically)
  markers: { x: number; z: number; id: number }[] = [];
  private markerSeq = 1;
  onGuide?: (p: THREE.Vector3 | null) => void;

  constructor(geo: Geo) {
    this.geo = geo;
    this.canvas = document.getElementById('gcs') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    // double-click to set/clear guide point (single click too easy to trigger by accident)
    this.canvas.addEventListener('dblclick', e => this.handleClick(e));
    this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.handleMark(e); });
  }

  cycle() {
    this.mode = this.mode === 'hidden' ? 'mini' : this.mode === 'mini' ? 'full' : 'hidden';
    this.applyMode();
  }

  setMode(m: GCSMode) { this.mode = m; this.applyMode(); }

  private applyMode() {
    const c = this.canvas;
    c.style.display = this.mode === 'hidden' ? 'none' : 'block';
    this.label.style.display = c.style.display;
    c.classList.toggle('full', this.mode === 'full');
    const r = c.getBoundingClientRect();
    this.label.style.left = r.left + 'px';
    this.label.style.top = r.top + 'px';
  }

  private worldToMap(x: number, z: number, cx: number, cz: number, mPerPx: number): [number, number] {
    const W = this.canvas.width, H = this.canvas.height;
    return [W / 2 + (x - cx) / mPerPx, H / 2 + (z - cz) / mPerPx];
  }

  private eventToWorld(e: MouseEvent): { wx: number; wz: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * this.canvas.width;
    const py = (e.clientY - rect.top) / rect.height * this.canvas.height;
    const mPerPx = this.mode === 'full' ? TERRAIN_SIZE / this.canvas.width : 300 / this.canvas.width;
    return {
      wx: this.centerX + (px - this.canvas.width / 2) * mPerPx,
      wz: this.centerZ + (py - this.canvas.height / 2) * mPerPx
    };
  }

  private handleClick(e: MouseEvent) {
    if (this.mode === 'hidden') return;
    const { wx, wz } = this.eventToWorld(e);
    // toggle off if clicking near existing guide point
    if (this.guidePoint && Math.hypot(this.guidePoint.x - wx, this.guidePoint.z - wz) < 12) {
      this.guidePoint = null;
    } else {
      this.guidePoint = new THREE.Vector3(wx, this.guidePoint?.y ?? 40, wz);
    }
    this.onGuide?.(this.guidePoint);
  }

  // right-click: add/remove a manual target marker
  private handleMark(e: MouseEvent) {
    if (this.mode === 'hidden') return;
    const { wx, wz } = this.eventToWorld(e);
    const near = this.markers.findIndex(m => Math.hypot(m.x - wx, m.z - wz) < 14);
    if (near >= 0) this.markers.splice(near, 1);
    else this.markers.push({ x: wx, z: wz, id: this.markerSeq++ });
  }

  private centerX = 0; private centerZ = 0;
  private lastDrone: Drone | null = null;
  private basemap: HTMLCanvasElement | null = null;

  setBasemap(c: HTMLCanvasElement) { this.basemap = c; }

  update(dt: number, drone: Drone, targets: Targets) {
    if (this.mode === 'hidden') return;
    this.lastDrone = drone;

    // trail
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.25;
      this.trail.push(new THREE.Vector2(drone.physics.pos.x, drone.physics.pos.z));
      if (this.trail.length > 240) this.trail.shift();
    }

    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    // center: full mode -> home; mini -> drone
    let cx = this.home.x, cz = this.home.z, mPerPx = TERRAIN_SIZE / W;
    if (this.mode === 'mini') { cx = drone.physics.pos.x; cz = drone.physics.pos.z; mPerPx = 300 / W; }
    this.centerX = cx; this.centerZ = cz;

    ctx.fillStyle = 'rgba(6,14,10,0.9)';
    ctx.fillRect(0, 0, W, H);

    // shaded-relief terrain basemap (photo-ish backdrop under the HUD grid)
    if (this.basemap) {
      const S = TERRAIN_SIZE;
      const visW = W * mPerPx, visH = H * mPerPx;
      const bx = this.basemap.width, by = this.basemap.height;
      const sx = ((cx - visW / 2) + S / 2) / S * bx;
      const sy = ((cz - visH / 2) + S / 2) / S * by;
      const sw = visW / S * bx, sh = visH / S * by;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.basemap, sx, sy, sw, sh, 0, 0, W, H);
      ctx.fillStyle = 'rgba(4,12,9,0.34)';
      ctx.fillRect(0, 0, W, H);
    }

    // grid (50m) with lat/lon annotations
    ctx.strokeStyle = 'rgba(57,255,136,0.12)';
    ctx.fillStyle = 'rgba(57,255,136,0.4)';
    ctx.font = '11px Consolas';
    ctx.lineWidth = 1;
    const step = 50;
    const x0 = Math.floor((cx - mPerPx * W / 2) / step) * step;
    for (let gx = x0; gx < cx + mPerPx * W / 2; gx += step) {
      const [mx] = this.worldToMap(gx, cz, cx, cz, mPerPx);
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
      if (gx % 100 === 0) {
        ctx.fillText(this.geo.toLatLon(gx, 0).lon.toFixed(4) + 'E', mx + 3, H - 44);
      }
    }
    const z0 = Math.floor((cz - mPerPx * H / 2) / step) * step;
    for (let gz = z0; gz < cz + mPerPx * H / 2; gz += step) {
      const [, my] = this.worldToMap(cx, gz, cx, cz, mPerPx);
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my); ctx.stroke();
      if (gz % 100 === 0) {
        ctx.fillText(this.geo.toLatLon(0, gz).lat.toFixed(4) + 'N', 6, my - 4);
      }
    }

    // boundary
    {
      const [x1, y1] = this.worldToMap(-TERRAIN_SIZE / 2, -TERRAIN_SIZE / 2, cx, cz, mPerPx);
      const [x2, y2] = this.worldToMap(TERRAIN_SIZE / 2, TERRAIN_SIZE / 2, cx, cz, mPerPx);
      ctx.strokeStyle = 'rgba(255,180,84,0.35)';
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    // jam zones
    for (const j of this.jamZones) {
      const [jx, jy] = this.worldToMap(j.x, j.z, cx, cz, mPerPx);
      const jr = j.r / mPerPx;
      ctx.fillStyle = 'rgba(255,60,60,0.12)';
      ctx.beginPath(); ctx.arc(jx, jy, jr, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,60,60,0.5)';
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,90,90,0.8)';
      ctx.fillText('JAM', jx - 12, jy);
    }

    // mission objectives are pre-marked in training mode (red diamonds)
    for (const t of targets.list) {
      if (!t.mission) continue;
      const [tx, ty] = this.worldToMap(t.pos.x, t.pos.z, cx, cz, mPerPx);
      ctx.strokeStyle = t.alive ? '#ff5040' : 'rgba(140,120,110,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty - 6); ctx.lineTo(tx + 6, ty); ctx.lineTo(tx, ty + 6); ctx.lineTo(tx - 6, ty);
      ctx.closePath(); ctx.stroke();
      if (!t.alive) {
        ctx.beginPath(); ctx.moveTo(tx - 4, ty - 4); ctx.lineTo(tx + 4, ty + 4);
        ctx.moveTo(tx + 4, ty - 4); ctx.lineTo(tx - 4, ty + 4); ctx.stroke();
      }
    }

    // home pad
    {
      const [hx, hy] = this.worldToMap(this.home.x, this.home.z, cx, cz, mPerPx);
      ctx.strokeStyle = 'rgba(120,220,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, 9, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(120,220,255,0.9)';
      ctx.fillText('H', hx - 4, hy + 4);
    }

    // targets are NOT drawn — recon is the pilot's job (manual markers only)

    // player-placed target markers
    for (const m of this.markers) {
      const [mx, my] = this.worldToMap(m.x, m.z, cx, cz, mPerPx);
      if (mx < -20 || mx > W + 20 || my < -20 || my > H + 20) continue;
      ctx.save();
      ctx.translate(mx, my);
      ctx.strokeStyle = '#ffcc33';
      ctx.fillStyle = '#ffcc33';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 0); ctx.lineTo(0, 8); ctx.lineTo(-7, 0); ctx.closePath();
      ctx.stroke();
      ctx.font = '10px Consolas';
      ctx.fillText('T' + m.id, 9, -6);
      ctx.restore();
    }

    // trail
    if (this.trail.length > 1) {
      ctx.strokeStyle = 'rgba(57,255,136,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      this.trail.forEach((p, i) => {
        const [mx, my] = this.worldToMap(p.x, p.y, cx, cz, mPerPx);
        i === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
      });
      ctx.stroke();
    }

    // guide point
    if (this.guidePoint) {
      const [gx, gy] = this.worldToMap(this.guidePoint.x, this.guidePoint.z, cx, cz, mPerPx);
      ctx.strokeStyle = '#33ddff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gx, gy - 8); ctx.lineTo(gx + 8, gy); ctx.lineTo(gx, gy + 8); ctx.lineTo(gx - 8, gy);
      ctx.closePath(); ctx.stroke();
      const gp = this.geo.toLatLon(this.guidePoint.x, this.guidePoint.z);
      ctx.fillStyle = '#33ddff';
      ctx.fillText(`${gp.lat.toFixed(4)} ${gp.lon.toFixed(4)}`, gx + 10, gy - 10);
    }

    // drop prediction
    if (this.dropPrediction) {
      const [dx, dy] = this.worldToMap(this.dropPrediction.x, this.dropPrediction.z, cx, cz, mPerPx);
      ctx.strokeStyle = 'rgba(255,220,90,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(dx, dy, 6, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx - 11, dy); ctx.lineTo(dx + 11, dy); ctx.moveTo(dx, dy - 11); ctx.lineTo(dx, dy + 11); ctx.stroke();
    }

    // drone marker
    {
      const p = drone.physics.pos;
      const [dx, dy] = this.worldToMap(p.x, p.z, cx, cz, mPerPx);
      const yaw = drone.physics.attitude.y;
      ctx.save();
      ctx.translate(dx, dy);
      ctx.rotate(-yaw); // world -z (north) maps to -y on canvas
      ctx.fillStyle = '#39ff88';
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
      // GPS position ring (drift indication)
      const gp = drone.sensors.gpsPos;
      const [gx, gy] = this.worldToMap(gp.x, gp.z, cx, cz, mPerPx);
      ctx.strokeStyle = 'rgba(57,255,136,0.3)';
      ctx.beginPath(); ctx.arc(gx, gy, 12, 0, 7); ctx.stroke();
      ctx.fillStyle = '#39ff88';
      ctx.font = '11px Consolas';
      ctx.fillText(`${p.y.toFixed(0)}m`, dx + 12, dy + 4);
    }

    // compass + scale + cursor coords
    ctx.fillStyle = 'rgba(57,255,136,0.75)';
    ctx.font = 'bold 13px Consolas';
    ctx.fillText('N ↑', W - 34, 20);
    const barPx = 50 / mPerPx;
    ctx.strokeStyle = 'rgba(57,255,136,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, H - 16); ctx.lineTo(14 + barPx, H - 16); ctx.stroke();
    ctx.fillText('50m', 16 + barPx, H - 12);

    const ll = this.geo.toLatLon(drone.physics.pos.x, drone.physics.pos.z);
    ctx.fillStyle = 'rgba(57,255,136,0.6)';
    ctx.fillText(`${ll.lat.toFixed(5)}°N ${ll.lon.toFixed(5)}°E`, 12, H - 30);
  }
}
