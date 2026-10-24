import * as THREE from 'three';
import { Drone } from '../drone/Drone';
import { Geo } from '../core/Geo';
import { deg } from '../core/utils';

// FPV on-screen-display: telemetry + artificial horizon ladder
export class OSD {
  private el = document.getElementById('osd')!;
  private tl = document.getElementById('osd-tl')!;
  private tr = document.getElementById('osd-tr')!;
  private bl = document.getElementById('osd-bl')!;
  private br = document.getElementById('osd-br')!;
  private warn = document.getElementById('osd-warning')!;
  private batt = document.getElementById('osd-batt')!;
  private lost = document.getElementById('osd-signal-lost')!;
  private ladder = document.getElementById('osd-ladder') as HTMLCanvasElement;
  private lctx = this.ladder.getContext('2d')!;
  private geo: Geo;

  constructor(geo: Geo) { this.geo = geo; }

  setVisible(v: boolean, digital: boolean) {
    this.el.style.display = v ? 'block' : 'none';
    this.el.classList.toggle('digital', digital);
  }

  setSignalLost(v: boolean) {
    this.lost.style.display = v ? 'flex' : 'none';
  }

  update(drone: Drone, linkQuality: number, guided: boolean, rth = false, integrity = 1) {
    const p = drone.sensors.gpsPos;
    const v = drone.physics.vel;
    const e = drone.physics.attitude;
    const b = drone.battery;
    const speed = v.length();
    const { lat, lon } = this.geo.toLatLon(p.x, p.z);

    const battV = b.voltage;
    const perCell = battV / b.cells;
    const battIcon = perCell > 3.9 ? '▮▮▮▮' : perCell > 3.7 ? '▮▮▮▯' : perCell > 3.5 ? '▮▮▯▯' : '▮▯▯▯';
    // battery readout is deliberately oversized — it is the one number the
    // pilot must be able to read at a glance through video noise
    this.batt.textContent = `${battIcon} ${battV.toFixed(1)}V  ${(b.soc * 100).toFixed(0)}%  电池 BATT`;
    this.batt.className = 'osd-corner batt' + (b.critical ? ' crit' : b.lowWarning ? ' warn' : '');

    this.tl.textContent =
      `${drone.fc.mode}  模式  THR ${(drone.physics.motorCmd.reduce((a, c) => a + c, 0) / 4 * 100).toFixed(0)}%\n` +
      (rth ? '◈ RTH 自动返航' : guided ? '◈ GUIDED 引导' : '◈ MANUAL 手动');

    this.tr.textContent =
      `LINK ${(linkQuality * 100).toFixed(0)}%  链路\n` +
      `SAT ${drone.sensors.gpsSats}  卫星  HDOP ${drone.sensors.gpsHdop.toFixed(1)}\n` +
      `${lat.toFixed(5)}°N ${lon.toFixed(5)}°E`;

    this.bl.textContent =
      `SPD ${(speed * 3.6).toFixed(0)}km/h  速度\n` +
      `ALT ${p.y.toFixed(1)}m  高度  V/S ${v.y.toFixed(1)}`;

    const heading = ((deg(e.y) % 360) + 360) % 360;
    this.br.textContent =
      `HDG ${heading.toFixed(0).padStart(3, '0')}°  航向\n` +
      `P ${deg(e.x).toFixed(0)}° R ${deg(-e.z).toFixed(0)}°  姿态`;

    // bilingual warnings
    let w = '';
    if (rth) w = 'AUTO RTH\n自动返航中';
    if (b.critical) w = 'BATTERY CRITICAL — LAND NOW\n电量耗尽 — 立即降落';
    else if (integrity < 0.35) w = 'AIRFRAME DAMAGED\n机体受损';
    else if (linkQuality < 0.35 && !rth) w = 'WEAK LINK\n信号弱';
    else if (b.lowWarning) w = 'LOW BATTERY\n电量偏低';
    this.warn.textContent = w;
    this.warn.style.display = w ? 'block' : 'none';
  }

  updateLadder(drone: Drone) {
    const e = drone.physics.attitude;
    this.drawLadder(e.x, e.z, e.y);
  }

  // attitude indicator ladder
  private drawLadder(pitch: number, roll: number, _yaw: number) {
    const ctx = this.lctx;
    const W = this.ladder.width, H = this.ladder.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(roll); // roll indication
    ctx.strokeStyle = 'rgba(57,255,136,0.85)';
    ctx.fillStyle = 'rgba(57,255,136,0.85)';
    ctx.lineWidth = 1.5;
    ctx.font = '10px Consolas';
    const pxPerDeg = 2.4;
    const pitchPx = pitch * 180 / Math.PI * pxPerDeg;
    ctx.translate(0, pitchPx);
    for (let d = -30; d <= 30; d += 10) {
      if (d === 0) continue;
      const y = -d * pxPerDeg;
      if (Math.abs(y + pitchPx) > H / 2 - 8) continue;
      const w = d % 20 === 0 ? 42 : 26;
      ctx.beginPath();
      ctx.moveTo(-w, y); ctx.lineTo(-w * 0.35, y);
      ctx.moveTo(w * 0.35, y); ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(String(Math.abs(d)), -w - 18, y + 3);
      ctx.fillText(String(Math.abs(d)), w + 6, y + 3);
    }
    // horizon
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-70, 0); ctx.lineTo(-18, 0);
    ctx.moveTo(18, 0); ctx.lineTo(70, 0);
    ctx.stroke();
    ctx.restore();
    // fixed aircraft symbol
    ctx.strokeStyle = 'rgba(255,220,120,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 22, H / 2); ctx.lineTo(W / 2 - 6, H / 2); ctx.lineTo(W / 2, H / 2 + 5);
    ctx.lineTo(W / 2 + 6, H / 2); ctx.lineTo(W / 2 + 22, H / 2);
    ctx.stroke();
  }
}
