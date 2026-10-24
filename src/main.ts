import * as THREE from 'three';
import { Terrain } from './world/Terrain';
import { Sky } from './world/Sky';
import { Targets } from './world/Targets';
import { Actors } from './world/Actors';
import { Wind } from './world/Wind';
import { Input } from './core/Input';
import { Geo } from './core/Geo';
import { AudioSys } from './core/Audio';
import { clamp } from './core/utils';
import { Drone } from './drone/Drone';
import { buildFPV, buildMAV, DroneBuild } from './drone/DroneModel';
import { FPV_SPEC, MAV_SPEC } from './drone/specs';
import { FPV_GAINS, MAV_GAINS } from './drone/FlightController';
import { Effects } from './payload/Effects';
import { Payload } from './payload/Payload';
import { PostFX } from './view/PostFX';
import { OSD } from './view/OSD';
import { GCSMap } from './view/GCSMap';
import { HUD } from './ui/HUD';
import { BootScreen } from './ui/Boot';

type DroneKind = 'fpv' | 'mav';
type ViewMode = 'FPV' | 'CHASE';
type CamPos = 'NOSE' | 'BELLY';

const LENSES = [
  { name: 'FISHEYE', fov: 118, k: 0.55 },
  { name: 'WIDE', fov: 100, k: 0.16 },
  { name: 'NORMAL', fov: 62, k: 0 }
];

class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private fpvCam!: THREE.PerspectiveCamera;
  private chaseCam!: THREE.PerspectiveCamera;
  private terrain!: Terrain;
  private sky!: Sky;
  private targets!: Targets;
  private actors!: Actors;
  private wind!: Wind;
  private effects!: Effects;
  private input!: Input;
  private audio!: AudioSys;
  private postfx!: PostFX;
  private osd!: OSD;
  private gcs!: GCSMap;
  private hud!: HUD;
  private geo = new Geo();

  private drone: Drone | null = null;
  private payload: Payload | null = null;
  private droneKind: DroneKind = 'fpv';
  private view: ViewMode = 'FPV';
  private camPos: CamPos = 'NOSE';
  private lensIdx = 0;
  private hoverAssist = true;

  private clock = new THREE.Clock();
  private acc = 0;
  private readonly FIXED = 1 / 240;

  private linkQuality = 1;
  private jamOverride = false;
  private fireQueued = false;      // left mouse main armament
  private nextFire = 0;            // grenade cooldown
  // training mission: marked objectives -> destroy -> return to base
  private missionPhase: 'PRE' | 'ACTIVE' | 'RTB' | 'DONE' = 'PRE';
  private chargeToastT = 0;
  private missionBeacons: { t: { alive: boolean; pos: THREE.Vector3 }; col: THREE.Mesh; dia: THREE.Mesh }[] = [];
  private rthActive = false;      // failsafe return-to-home is flying
  private linkLostTime = 0;       // seconds of complete signal loss
  private headYaw = 0; private headPitch = 0;
  private camStabQ = new THREE.Quaternion();
  private camLocalQ = new THREE.Quaternion();
  private camEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private lookDrag = false;
  private time = 0;
  private osdTimer = 0;
  private score = 0;
  private lostOverlayT = 0;      // seconds of continuous signal loss (overlay debounce)
  private hitPenalty = 0;        // temporary link loss while rounds are incoming
  private hitCooldown = 0;
  private collideCooldown = 0;
  private integrity = 1;         // airframe damage: 1 pristine, 0 destroyed

  private home = new THREE.Vector3(0.8, 2.62, 0);   // launch-truck deck

  constructor() {}

  // staged startup: the YCC boot screen paints between the heavy build steps
  async init(boot: BootScreen) {
    await boot.step('KERNEL 内核', '会话 · 时钟 · 输入管线', 6);
    this.initRenderer();
    await boot.step('RENDERER 渲染器', 'WebGL · 后期处理', 16);
    this.terrain = new Terrain();
    this.scene.add(this.terrain.group);
    await boot.step('TERRAIN 地形', '2000m 训练场 · 丘陵起伏', 34);
    this.sky = new Sky(this.scene);
    await boot.step('SKY 天空', '大气散射 · 日光', 44);
    this.targets = new Targets((x, z) => this.terrain.heightAt(x, z));
    this.scene.add(this.targets.group);
    this.buildMission();
    await boot.step('TARGETS 靶标', '坦克 · 碉堡 · 雷达', 56);
    this.actors = new Actors((x, z) => this.terrain.heightAt(x, z));
    this.actors.onHit = p => this.onDroneHit(p);
    this.scene.add(this.actors.group);
    this.wind = new Wind();
    this.effects = new Effects(this.scene);
    await boot.step('FLEET 载具人员', '装甲运输车 · 士兵 · 障碍', 68);
    this.input = new Input();
    this.audio = new AudioSys();
    this.postfx = new PostFX(this.renderer, this.scene, this.fpvCam);
    this.osd = new OSD(this.geo);
    this.gcs = new GCSMap(this.geo);
    this.hud = new HUD(this.geo);
    this.gcs.home.copy(this.home);
    this.gcs.setBasemap(this.terrain.buildBasemap());
    this.gcs.jamZones = [{ x: 300, z: 400, r: 110 }, { x: -500, z: 200, r: 120 }, { x: 620, z: -180, r: 90 }];
    this.gcs.onGuide = p => {
      if (!this.drone) return;
      if (p) {
        const target = new THREE.Vector3(p.x, Math.max(p.y, 12), p.z);
        this.hoverAssist = true; // guided nav requires hover assist
        this.applyControlMode();
        this.drone.fc.setGuidedTarget(target);
        this.hud.toast(`GUIDE → ${this.geo.format(p.x, p.z)} / 引导至该点`, 2600);
      } else {
        this.drone.fc.setGuidedTarget(null);
        this.hud.toast('GUIDE CANCELLED / 引导已取消');
      }
    };
    await boot.step('AVIONICS 航电', '飞控 · 链路 · 地面站', 84);
    this.bindMenu();
    this.bindMouse();
    this.renderer.setAnimationLoop(() => this.frame());
    await boot.step('SYSTEMS 系统', '所有子系统就绪', 96);
    await boot.finish();
  }

  private initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // left mouse on the 3D view = fire a grenade along the current view direction
    this.renderer.domElement.addEventListener('mousedown', e => { if (e.button === 0) this.fireQueued = true; });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.fpvCam = new THREE.PerspectiveCamera(118, innerWidth / innerHeight, 0.05, 4000);
    this.chaseCam = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 4000);
    this.chaseCam.layers.enable(1); // chase view shows carried ordnance (layer 1)

    window.addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      const ar = innerWidth / innerHeight;
      this.fpvCam.aspect = ar; this.fpvCam.updateProjectionMatrix();
      this.chaseCam.aspect = ar; this.chaseCam.updateProjectionMatrix();
      this.postfx.setSize(innerWidth, innerHeight);
    });
  }

  private groundY(x: number, z: number): number {
    let g = this.terrain.heightAt(x, z);
    if (Math.abs(x - 0.8) < 3.0 && Math.abs(z) < 1.25) g = Math.max(g, 2.48); // launch-truck deck
    if (Math.hypot(x - 14, z + 6) < 7) g = Math.max(g, 0.25); // helipad deck
    return g;
  }

  private buildDrone(kind: DroneKind) {
    if (this.drone) this.scene.remove(this.drone.model.group);
    this.droneKind = kind;
    let model: DroneBuild;
    let drone: Drone;
    if (kind === 'fpv') {
      model = buildFPV();
      drone = new Drone(FPV_SPEC, FPV_GAINS, model, 4, 3000, false);
      this.lensIdx = 0;
    } else {
      model = buildMAV();
      drone = new Drone(MAV_SPEC, MAV_GAINS, model, 4, 6000, true);
      drone.gimbalPitch = -0.35;
      this.lensIdx = 1;
    }
    this.applyLens();
    drone.reset(this.home.clone(), 0);
    this.scene.add(model.group);
    this.drone = drone;
    this.hoverAssist = true;
    this.applyControlMode();
    this.gcs.guidePoint = null;
    this.rthActive = false;
    this.linkLostTime = 0;
    this.lostOverlayT = 0;
    this.hitPenalty = 0;
    this.hitCooldown = 0;
    this.integrity = 1;

    this.payload = new Payload(
      this.scene, model.payloadMount,
      kind === 'fpv' ? { vog: 2, marker: 1 } : { bomb: 4, marker: 2 },
      this.effects, this.targets, this.wind,
      (x, z) => this.groundY(x, z)
    );
    this.payload.onImpact = (pk, pos, killed) => {
      if (pk === 'marker') { this.hud.toast('MARKER DEPLOYED / 标记已投放'); this.audio.beep(900, 0.15); return; }
      this.audio.explosion(KIND_POWER(pk));
      if (killed > 0) { this.score += killed * 100; this.hud.toast(`TARGET NEUTRALIZED ×${killed} / 目标命中 ×${killed}  (+${killed * 100})`); }
    };
    this.payload.actors = this.actors;
  }

  private applyLens() {
    const lens = LENSES[this.lensIdx];
    this.fpvCam.fov = lens.fov;
    this.fpvCam.updateProjectionMatrix();
    this.postfx.fpvPass.uniforms.uFisheye.value = lens.k;
  }

  // hover assist: throttle becomes climb-rate, sticks centered = hold altitude
  private applyControlMode() {
    const d = this.drone!;
    const assisted = this.hoverAssist && d.fc.mode === 'ANGLE';
    d.fc.altHold = assisted;
    this.input.selfCenterThrottle = assisted;
    if (!assisted) this.input.resetThrottle(0.0);
    if (assisted) d.fc.setTargetAlt(d.physics.pos.y);
  }

  private bindMenu() {
    const cardFpv = document.getElementById('card-fpv')!;
    const cardMav = document.getElementById('card-mavic')!;
    let sel: DroneKind = 'fpv';
    const update = () => {
      cardFpv.classList.toggle('sel', sel === 'fpv');
      cardMav.classList.toggle('sel', sel === 'mav');
    };
    cardFpv.onclick = () => { sel = 'fpv'; update(); };
    cardMav.onclick = () => { sel = 'mav'; update(); };
    document.getElementById('launch')!.onclick = () => {
      this.audio.init();
      this.buildDrone(sel);
      document.getElementById('menu')!.classList.add('hidden');
      this.osd.setVisible(true, sel === 'mav');
      this.postfx.setFPV(this.view === 'FPV');
      this.gcs.setMode('mini');
      this.hud.toast(`${sel === 'fpv' ? 'FPV-5' : 'MAV-9'} READY — THROTTLE UP TO LAUNCH / 准备就绪 — 推油门起飞`, 3000);
    };
  }

  private bindMouse() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mousedown', e => { if (e.button === 2) this.lookDrag = true; });
    window.addEventListener('mouseup', e => { if (e.button === 2) this.lookDrag = false; });
    window.addEventListener('mousemove', e => {
      if (this.lookDrag && this.view === 'FPV') {
        this.headYaw = clamp(this.headYaw - e.movementX * 0.0022, -1.2, 1.2);
        this.headPitch = clamp(this.headPitch - e.movementY * 0.0022, -0.7, 0.7);
      }
    });
    window.addEventListener('wheel', e => {
      if (this.drone?.isMAV) {
        this.drone.gimbalPitch = clamp(this.drone.gimbalPitch - e.deltaY * 0.0009, -1.45, 0.25);
      }
    });
  }

  private handleActions() {
    const inp = this.input;
    const d = this.drone;
    if (!d) return;

    if (inp.wasPressed('KeyV') || inp.padPressed(2)) {
      this.view = this.view === 'FPV' ? 'CHASE' : 'FPV';
      this.postfx.setFPV(this.view === 'FPV');
      this.osd.setVisible(this.view === 'FPV', d.isMAV);
      document.getElementById('crosshair-dot')!.style.display = this.view === 'CHASE' ? 'block' : 'none';
      this.hud.toast(this.view === 'FPV' ? 'FPV CAM / FPV 视角' : 'CHASE CAM / 追尾视角');
    }
    if (inp.wasPressed('KeyM') || inp.padPressed(3)) this.gcs.cycle();
    if (inp.wasPressed('KeyC')) {
      this.camPos = this.camPos === 'NOSE' ? 'BELLY' : 'NOSE';
      // belly cam looks straight down through the bomb rack — hide layer 1
      if (this.camPos === 'BELLY') this.fpvCam.layers.disable(1);
      else this.fpvCam.layers.enable(1);
      this.headYaw = 0; this.headPitch = 0;
      this.hud.toast(this.camPos === 'NOSE' ? 'NOSE CAMERA / 前置摄像头' : 'BELLY CAMERA (VERTICAL) / 下视摄像头');
      this.audio.beep(this.camPos === 'NOSE' ? 1100 : 800);
    }
    if (inp.wasPressed('KeyU')) {
      this.lensIdx = (this.lensIdx + 1) % LENSES.length;
      this.applyLens();
      this.hud.toast(`LENS 镜头: ${LENSES[this.lensIdx].name}`);
    }
    if (inp.wasPressed('KeyT')) {
      this.hoverAssist = !this.hoverAssist;
      this.applyControlMode();
      this.hud.toast(this.hoverAssist ? 'HOVER ASSIST ON / 定高悬停开启' : 'MANUAL THROTTLE / 手动油门');
      this.audio.beep(this.hoverAssist ? 1100 : 650);
    }
    if (inp.wasPressed('KeyF') || inp.padPressed(1)) {
      d.fc.mode = d.fc.mode === 'ANGLE' ? 'ACRO' : 'ANGLE';
      this.applyControlMode(); // ACRO forces manual throttle; ANGLE restores assist
      this.hud.toast(`MODE 模式: ${d.fc.mode}${d.fc.mode === 'ACRO' ? ' / 手动油门' : ''}`);
      this.audio.beep(d.fc.mode === 'ACRO' ? 700 : 1100);
    }
    if (inp.wasPressed('KeyB') || inp.padPressed(0)) {
      const kind = d.isMAV ? 'bomb' : 'vog';
      if (this.payload!.drop(kind, d.physics.pos, d.physics.quat, d.physics.vel)) {
        this.audio.release();
        this.hud.toast(`${kind.toUpperCase()} RELEASED / 已投放`);
      } else this.hud.toast('NO ORDNANCE LEFT / 弹药耗尽');
    }
    if (inp.wasPressed('KeyN')) {
      if (this.payload!.drop('marker', d.physics.pos, d.physics.quat, d.physics.vel)) {
        this.audio.release();
      } else this.hud.toast('NO MARKERS LEFT / 标记弹耗尽');
    }
    if (inp.wasPressed('KeyX')) {
      this.jamOverride = !this.jamOverride;
      this.hud.toast(this.jamOverride ? '⚠ JAMMING ACTIVE / 干扰开启' : 'JAMMING CEASED / 干扰结束');
    }
    if (inp.wasPressed('KeyR') || inp.padPressed(9)) {
      d.reset(this.home.clone(), 0);
      this.input.resetThrottle(0);
      this.gcs.guidePoint = null;
      this.rebuildPayload();
      this.hud.toast('RESET / 已重置 — NEW AIRFRAME ON PAD / 新机体已就位', 2600);
    }
    if (inp.wasPressed('Digit1')) this.switchDrone('fpv');
    if (inp.wasPressed('Digit2')) this.switchDrone('mav');
    if (inp.wasPressed('KeyG')) {
      d.fc.setGuidedTarget(null);
      this.gcs.guidePoint = null;
      this.hud.toast('MANUAL CONTROL / 手动控制');
    }
  }

  private rebuildPayload() {
    const d = this.drone!;
    this.payload = new Payload(
      this.scene, d.model.payloadMount,
      d.isMAV ? { bomb: 4, marker: 2 } : { vog: 2, marker: 1 },
      this.effects, this.targets, this.wind,
      (x, z) => this.groundY(x, z)
    );
    this.payload.onImpact = (pk, pos, killed) => {
      if (pk === 'marker') { this.hud.toast('MARKER DEPLOYED / 标记已投放'); this.audio.beep(900, 0.15); return; }
      this.audio.explosion(KIND_POWER(pk));
      if (killed > 0) { this.score += killed * 100; this.hud.toast(`TARGET NEUTRALIZED ×${killed} / 目标命中 ×${killed}  (+${killed * 100})`); }
    };
    this.payload.actors = this.actors;
  }

  private switchDrone(kind: DroneKind) {
    if (kind === this.droneKind || !this.drone) return;
    this.buildDrone(kind);
    this.osd.setVisible(this.view === 'FPV', kind === 'mav');
    this.hud.toast(`${kind === 'fpv' ? 'FPV-5' : 'MAV-9'} DEPLOYED / 已部署`);
  }

  // a sentry round connected: kick the airframe about and drop the link briefly
  private onDroneHit(_p: THREE.Vector3) {
    const d = this.drone;
    if (!d || this.hitCooldown > 0) return;
    this.hitCooldown = 0.7;
    this.hitPenalty = Math.min(0.6, this.hitPenalty + 0.3);
    this.integrity = Math.max(0, this.integrity - (0.10 + Math.random() * 0.08));
    d.physics.vel.add(new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 2.4));
    d.physics.omega.set((Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 2.0);
    const dmg = ((1 - this.integrity) * 100).toFixed(0);
    this.hud.toast(`UAV HIT — DMG ${dmg}% / 无人机中弹 — 损伤 ${dmg}%`, 2000);
    this.audio.beep(180, 0.12);
    if (this.integrity <= 0) {
      this.hud.toast('AIRFRAME DESTROYED / 机体损毁 — AUTO RESPAWN / 自动重置', 3200);
      this.buildDrone(this.droneKind);
      this.osd.setVisible(this.view === 'FPV', this.droneKind === 'mav');
    }
  }

  // tall red light columns + bobbing diamonds over the pre-marked objectives
  private buildMission() {
    for (const t of this.targets.list) {
      if (!t.mission) continue;
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.4, 70, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
      );
      col.position.set(t.pos.x, t.pos.y + 35, t.pos.z);
      const dia = new THREE.Mesh(new THREE.OctahedronGeometry(1.7), new THREE.MeshBasicMaterial({ color: 0xff5533 }));
      dia.position.set(t.pos.x, t.pos.y + 10, t.pos.z);
      this.scene.add(col, dia);
      this.missionBeacons.push({ t, col, dia });
    }
  }

  private updateMission(dt: number, d: Drone) {
    const total = this.missionBeacons.length;
    if (total === 0) return;
    let done = 0;
    for (const b of this.missionBeacons) {
      if (!b.t.alive) { done++; b.col.visible = false; b.dia.visible = false; continue; }
      b.dia.position.y = b.t.pos.y + 10 + Math.sin(this.time * 2.2) * 0.8;
      b.dia.rotation.y += dt * 1.6;
      (b.col.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(this.time * 3));
    }
    const agl = d.physics.pos.y - this.groundY(d.physics.pos.x, d.physics.pos.z);
    const distHome = Math.hypot(d.physics.pos.x - this.home.x, d.physics.pos.z - this.home.z);
    if (this.missionPhase === 'PRE' && agl > 2) {
      this.missionPhase = 'ACTIVE';
      this.hud.toast('任务开始：前往西南角摧毁标红目标 / MISSION START — DESTROY MARKED TARGETS (SW CORNER)', 4500);
      this.audio.beep(1000, 0.3);
    } else if (this.missionPhase === 'ACTIVE' && done === total) {
      this.missionPhase = 'RTB';
      this.hud.toast('目标全部摧毁 — 返航 / ALL TARGETS DESTROYED — RETURN TO BASE', 4500);
      this.audio.beep(1400, 0.4);
    } else if (this.missionPhase === 'RTB' && distHome < 12 && agl < 3) {
      this.missionPhase = 'DONE';
      this.hud.toast('任务完成 / MISSION COMPLETE', 5200);
      this.audio.beep(1600, 0.6);
    }
    let txt = '待命 STANDBY';
    if (this.missionPhase === 'ACTIVE') {
      let best: THREE.Vector3 | null = null, bd = 1e9;
      for (const b of this.missionBeacons) if (b.t.alive) { const dd = b.t.pos.distanceTo(d.physics.pos); if (dd < bd) { bd = dd; best = b.t.pos; } }
      if (best) {
        const dx = best.x - d.physics.pos.x, dz = best.z - d.physics.pos.z;
        const brg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
        txt = `摧毁 ${done}/${total} · ${Math.round(bd)}m ${Math.round(brg)}°`;
      }
    } else if (this.missionPhase === 'RTB') txt = `返航 RTB ${Math.round(distHome)}m`;
    else if (this.missionPhase === 'DONE') txt = '完成 DONE';
    this.hud.setMission(txt);
  }

  private updateLink() {
    const d = this.drone!;
    const dist = Math.hypot(d.physics.pos.x - this.home.x, d.physics.pos.z - this.home.z);
    let q = 1 - Math.pow(clamp(dist / 1600, 0, 1), 1.8);
    q *= 0.9 + 0.1 * Math.sin(this.time * 0.7) * Math.random();
    for (const j of this.gcs.jamZones) {
      const dd = Math.hypot(d.physics.pos.x - j.x, d.physics.pos.y - this.groundY(j.x, j.z), d.physics.pos.z - j.z);
      if (dd < j.r) q *= 0.12 + 0.88 * Math.pow(dd / j.r, 2);
    }
    if (this.jamOverride) q *= 0.06;
    // tank-borne electromagnetic interference bubbles (fly around them)
    for (const t of this.targets.list) {
      if (!t.alive || t.jamRadius <= 0) continue;
      const dd = d.physics.pos.distanceTo(t.pos); // 3D: climbing above the tank escapes the bubble
      if (dd < t.jamRadius) q *= 0.06 + 0.94 * Math.pow(dd / t.jamRadius, 2);
    }
    q *= 1 - this.hitPenalty;
    this.linkQuality = clamp(q, 0, 1);
  }

  // failsafe: after complete video/control loss the aircraft flies itself home
  // and hands control back once the link is re-established near the pad
  private updateRTH(dt: number, d: Drone) {
    if (this.linkQuality < 0.06) this.linkLostTime += dt;
    else this.linkLostTime = Math.max(0, this.linkLostTime - dt * 2);

    if (!this.rthActive && this.linkLostTime > 2.5) {
      this.rthActive = true;
      this.hoverAssist = true;
      this.applyControlMode();
      d.fc.setGuidedTarget(new THREE.Vector3(this.home.x, 18, this.home.z));
      this.hud.toast('LINK LOST — AUTO RTH / 链路中断 — 自动返航', 3800);
      this.audio.beep(520, 0.5);
    }

    if (this.rthActive) {
      const distHome = Math.hypot(d.physics.pos.x - this.home.x, d.physics.pos.z - this.home.z);
      if (distHome < 7 && this.linkQuality > 0.25) {
        this.rthActive = false;
        this.linkLostTime = 0;
        d.fc.setGuidedTarget(null);
        this.hud.toast('RTH COMPLETE — CONTROL RESTORED / 返航完成 — 已交还控制', 3400);
        this.audio.beep(1200, 0.25);
      }
    }
  }

  private frame() {
    const dt = clamp(this.clock.getDelta(), 0.0001, 0.05);
    this.time += dt;
    let d = this.drone;

    this.wind.update(dt);
    this.targets.update(dt, this.time);
    this.hitPenalty = Math.max(0, this.hitPenalty - dt * 0.45);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.collideCooldown = Math.max(0, this.collideCooldown - dt);

    if (d) {
      // battery exhausted: respawn on the pad with a fresh pack
      if (d.battery.soc <= 0.001) {
        this.hud.toast('BATTERY EMPTY — AUTO RESPAWN / 电量耗尽 — 自动复位', 3200);
        this.buildDrone(this.droneKind);
        this.osd.setVisible(this.view === 'FPV', this.droneKind === 'mav');
        d = this.drone!;
      }

      const sticks = this.input.poll(dt);
      // manual stick input cancels guided nav (any axis — yaw included);
      // ignored while the failsafe autopilot is returning home
      if (!this.rthActive && d.fc.guidedActive &&
          (Math.abs(sticks.roll) + Math.abs(sticks.pitch) > 0.3 || Math.abs(sticks.yaw) > 0.25)) {
        d.fc.setGuidedTarget(null);
        this.gcs.guidePoint = null;
        this.hud.toast('MANUAL OVERRIDE / 手动接管');
      }

      d.damageScale = 0.75 + 0.25 * this.integrity; // battle damage bleeds thrust
      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.FIXED && steps < 20) {
        d.step(this.FIXED, sticks, this.wind, this.groundY(d.physics.pos.x, d.physics.pos.z), this.input.climbCmd);
        this.acc -= this.FIXED;
        steps++;
      }
      d.syncVisual(dt);
      this.actors.update(dt, d.physics.pos, d.physics.vel);
      const hit = this.terrain.collide(d.physics.pos, d.physics.vel);
      if (hit && this.collideCooldown <= 0) {
        this.collideCooldown = 1.4;
        this.hud.toast(hit.net ? 'NET IMPACT — REROUTE / 撞上拦截网 — 请绕行' : 'OBSTACLE IMPACT / 撞击障碍物', 1600);
        this.audio.beep(220, 0.08);
      }
      this.handleActions();
      // main armament: left mouse launches a grenade toward the crosshair
      if (this.fireQueued) {
        this.fireQueued = false;
        if (!d.crashed && !this.rthActive && this.time >= this.nextFire) {
          this.nextFire = this.time + 0.22;
          const cam = this.view === 'FPV' ? this.fpvCam : this.chaseCam;
          const dir = new THREE.Vector3();
          cam.getWorldDirection(dir);
          this.payload!.fireGrenade(d.physics.pos, dir, d.physics.vel);
          this.audio.release();
        }
      }
      this.payload!.update(dt);
      this.effects.update(dt);
      this.updateLink();
      this.updateRTH(dt, d);
      this.updateMission(dt, d);

      // base support: landing on / hovering by the launch truck recharges the
      // pack and repairs airframe damage
      const distHomeB = Math.hypot(d.physics.pos.x - this.home.x, d.physics.pos.z - this.home.z);
      const aglB = d.physics.pos.y - this.groundY(d.physics.pos.x, d.physics.pos.z);
      if (distHomeB < 12 && aglB < 5 && (d.battery.soc < 0.999 || this.integrity < 0.999)) {
        d.battery.soc = Math.min(1, d.battery.soc + dt * 0.08);
        this.integrity = Math.min(1, this.integrity + dt * 0.05);
        if (this.chargeToastT <= 0) { this.hud.toast('充电 / 修复中 CHARGING & REPAIRING', 2200); this.chargeToastT = 8; }
      }
      this.chargeToastT = Math.max(0, this.chargeToastT - dt);

      // drop prediction for GCS
      const offset = new THREE.Vector3(0, -0.12, 0).applyQuaternion(d.physics.quat);
      this.gcs.dropPrediction = this.payload!.totalAmmo() > 0
        ? this.payload!.predictImpact(d.physics.pos.clone().add(offset), d.physics.vel.clone())
        : null;

      // cameras
      if (this.view === 'FPV') {
        const mount = this.camPos === 'NOSE' ? d.model.cameraMount : d.model.bellyMount;
        mount.getWorldPosition(this.fpvCam.position);
        mount.getWorldQuaternion(this.fpvCam.quaternion);
        if (this.camPos === 'NOSE' && !d.isMAV) {
          // keep only ~30% of pitch / ~45% of roll so the picture stays usable
          const e = d.physics.attitude;
          this.camStabQ.setFromEuler(this.camEuler.set(e.x * 0.30, e.y, e.z * 0.45, 'YXZ'));
          this.camLocalQ.copy(d.physics.quat).invert().multiply(this.fpvCam.quaternion);
          this.camStabQ.multiply(this.camLocalQ);
          this.fpvCam.quaternion.slerp(this.camStabQ, 1 - Math.exp(-10 * dt));
        }
        if (this.camPos === 'NOSE' && !d.isMAV) {
          this.fpvCam.rotateY(this.headYaw);
          this.fpvCam.rotateX(this.headPitch);
        } else {
          this.headYaw *= 0.9; this.headPitch *= 0.9;
        }
        this.postfx.setCamera(this.fpvCam);
      } else {
        const back = new THREE.Vector3(0, 2.4, 5.2).applyQuaternion(d.physics.quat).add(d.physics.pos);
        this.chaseCam.position.lerp(back, 1 - Math.exp(-5 * dt));
        const look = d.physics.pos.clone().addScaledVector(d.physics.vel, 0.25);
        this.chaseCam.lookAt(look);
        this.postfx.setCamera(this.chaseCam);
      }

      this.sky.follow(d.physics.pos);

      // grounded: keep hold-altitude reference at ground so it won't bounce up
      const gY = this.groundY(d.physics.pos.x, d.physics.pos.z);
      if (d.physics.pos.y - gY < 0.15 && Math.abs(d.physics.vel.y) < 0.4) {
        d.fc.setTargetAlt(d.physics.pos.y);
      }

      // audio
      const camPos = this.view === 'FPV' ? this.fpvCam.position : this.chaseCam.position;
      const dist = this.view === 'FPV' ? 0.4 : camPos.distanceTo(d.physics.pos);
      const avgThr = d.physics.motorCmd.reduce((a, b) => a + b, 0) / 4;
      this.audio.updateMotors(d.physics.motorOmega, d.physics.vel.length(), dist, avgThr);

      // OSD (text at 12 Hz, ladder every frame)
      this.osdTimer -= dt;
      if (this.view === 'FPV') {
        if (this.osdTimer <= 0) { this.osdTimer = 1 / 12; this.osd.update(d, this.linkQuality, d.fc.guidedActive, this.rthActive, this.integrity); }
        this.osd.updateLadder(d);
        this.lostOverlayT = this.linkQuality < 0.1 ? this.lostOverlayT + dt : 0;
        this.osd.setSignalLost(this.lostOverlayT > 0.45);
      }
      this.gcs.update(dt, d, this.targets);
      const viewName = this.view === 'FPV'
        ? `FPV·${this.camPos === 'BELLY' ? 'DOWN' : 'NOSE'}·${LENSES[this.lensIdx].name}`
        : 'CHASE';
      this.hud.update(dt, d, viewName, this.linkQuality, this.payload!.totalAmmo(), this.integrity);
      this.postfx.updateLink(dt, this.time, this.linkQuality, d.isMAV);
    }

    this.postfx.render(dt);
  }
}

function KIND_POWER(pk: string) { return pk === 'bomb' ? 2.2 : pk === 'grenade' ? 1.2 : pk === 'vog' ? 1.0 : 0; }

const __boot = new BootScreen();
const __g = new Game();
(window as any).__game = __g;
__g.init(__boot).catch(err => { console.error(err); __boot.fail(err); });

