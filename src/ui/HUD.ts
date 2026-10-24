import { Drone } from '../drone/Drone';
import { Geo } from '../core/Geo';

// top status bar + toast messages
export class HUD {
  private model = document.getElementById('tb-model')!;
  private view = document.getElementById('tb-view')!;
  private mode = document.getElementById('tb-mode')!;
  private batt = document.getElementById('tb-batt')!;
  private link = document.getElementById('tb-link')!;
  private gps = document.getElementById('tb-gps')!;
  private ammo = document.getElementById('tb-ammo')!;
  private dmg = document.getElementById('tb-dmg')!;
  private toastEl = document.getElementById('toast')!;
  private msn = document.getElementById('tb-msn');

  setMission(s: string) { if (this.msn) this.msn.textContent = s; }
  private toastTimer = 0;
  private geo: Geo;

  constructor(geo: Geo) { this.geo = geo; }

  toast(msg: string, ms = 2200) {
    this.toastTimer = ms / 1000;
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
  }

  update(dt: number, drone: Drone, viewName: string, linkQ: number, ammo: number, integrity = 1) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = '0';
    }
    this.model.textContent = drone.spec.name;
    this.view.textContent = viewName;
    this.mode.textContent = drone.fc.mode + (drone.fc.guidedActive ? '+NAV' : '');

    const v = drone.battery.voltage;
    this.batt.textContent = `${v.toFixed(1)}V ${(drone.battery.soc * 100).toFixed(0)}%`;
    this.batt.className = 'tb-batt' + (drone.battery.critical ? ' crit' : drone.battery.lowWarning ? ' warn' : '');

    this.link.textContent = `${(linkQ * 100).toFixed(0)}%`;
    this.link.className = linkQ < 0.3 ? 'crit' : linkQ < 0.6 ? 'warn' : '';

    const gp = drone.sensors.gpsPos;
    this.gps.textContent = this.geo.format(gp.x, gp.z);
    this.ammo.textContent = ammo === Infinity ? '∞' : String(ammo);
    const bars = Math.max(0, Math.ceil(integrity * 5));
    this.dmg.textContent = '▮'.repeat(bars) + '▯'.repeat(5 - bars) + ` ${(integrity * 100).toFixed(0)}%`;
    this.dmg.className = integrity < 0.25 ? 'crit' : integrity < 0.5 ? 'warn' : '';
  }
}
