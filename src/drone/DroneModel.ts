import * as THREE from 'three';
import { carbonFiber, propBlur, metal } from '../world/Textures';

export interface PropRef {
  pivot: THREE.Group;
  blades: THREE.Object3D;
  disc: THREE.Mesh;
  spinSign: number;
}

export interface DroneBuild {
  group: THREE.Group;
  props: PropRef[];
  cameraMount: THREE.Object3D;   // FPV camera position/orientation
  bellyMount: THREE.Object3D;    // downward-facing camera
  gimbal?: THREE.Object3D;       // MAV gimbal (pitch stabilized)
  payloadMount: THREE.Object3D;
  motorPositions: THREE.Vector3[];
}

// shared: downward-looking camera pod
function makeBellyCam(y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(0, y, z);
  g.rotation.x = -Math.PI / 2; // camera looks straight down
  const housing = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.3 })
  );
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.006, 10),
    new THREE.MeshStandardMaterial({ color: 0x1a3a88, roughness: 0.08, metalness: 0.9, emissive: 0x0a1a44, emissiveIntensity: 0.4 })
  );
  // glass sits at the bottom of the housing, facing down
  glass.rotation.x = Math.PI / 2;
  glass.position.y = -0.009;
  housing.rotation.x = Math.PI / 2;
  g.add(housing, glass);
  return g;
}

let blurTex: THREE.CanvasTexture | null = null;

function makeProp(radius: number, bladeColor: number): PropRef {
  if (!blurTex) blurTex = propBlur();
  const pivot = new THREE.Group();

  const blades = new THREE.Group();
  const bladeGeo = new THREE.BoxGeometry(radius * 0.92, radius * 0.035, radius * 0.16);
  bladeGeo.translate(radius * 0.5, 0, 0);
  bladeGeo.rotateY(0.28); // pitch twist
  const mat = new THREE.MeshStandardMaterial({ color: bladeColor, roughness: 0.5, metalness: 0.1 });
  for (const s of [1, -1]) {
    const b = new THREE.Mesh(bladeGeo, mat);
    b.scale.x = s;
    b.rotation.y = s > 0 ? 0 : Math.PI;
    const holder = new THREE.Group();
    holder.add(b);
    holder.rotation.y = s > 0 ? 0 : 0;
    blades.add(holder);
  }
  // hub
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.1, radius * 0.12, radius * 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4 })
  );
  blades.add(hub);
  pivot.add(blades);

  const discGeo = new THREE.CircleGeometry(radius, 40);
  const discMat = new THREE.MeshBasicMaterial({
    map: blurTex, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, opacity: 0
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = radius * 0.02;
  pivot.add(disc);

  return { pivot, blades, disc, spinSign: 1 };
}

function motor(r: number, h: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ map: metal('#8f959c'), roughness: 0.35, metalness: 0.85 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.6, h * 0.35, 12), metalMat);
  base.position.y = h * 0.18;
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, h * 0.55, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.8 }));
  bell.position.y = h * 0.62;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.35, h * 0.14, 10),
    new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4, metalness: 0.6 }));
  cap.position.y = h * 0.97;
  g.add(base, bell, cap);
  return g;
}

// ---------------- 5" FPV freestyle ----------------
export function buildFPV(): DroneBuild {
  const group = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ map: carbonFiber(), roughness: 0.55, metalness: 0.25 });
  const darkPlastic = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6 });

  const arm = 0.113;
  // main plate
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.128, 0.004, 0.128), carbon);
  plate.position.y = 0.02;
  // top plate
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.003, 0.1), carbon);
  top.position.y = 0.046;
  // standoffs
  const standoffGeo = new THREE.CylinderGeometry(0.0028, 0.0028, 0.026, 8);
  const standoffMat = new THREE.MeshStandardMaterial({ color: 0xb03a2e, metalness: 0.7, roughness: 0.3 });
  for (const [sx, sz] of [[-0.042, -0.042], [0.042, -0.042], [-0.042, 0.042], [0.042, 0.042]]) {
    const st = new THREE.Mesh(standoffGeo, standoffMat);
    st.position.set(sx, 0.033, sz);
    group.add(st);
  }
  group.add(plate, top);

  // arms (X layout)
  const armGeo = new THREE.BoxGeometry(0.098, 0.004, 0.016);
  armGeo.translate(0.049, 0, 0);
  const props: PropRef[] = [];
  const motorPositions: THREE.Vector3[] = [];
  const a = arm * Math.SQRT1_2;
  const corners: [number, number][] = [[-a, -a], [a, -a], [-a, a], [a, a]]; // FL FR BL BR
  corners.forEach(([cx, cz], i) => {
    const armMesh = new THREE.Mesh(armGeo, carbon);
    const angle = Math.atan2(cz, cx);
    armMesh.rotation.y = -angle;
    armMesh.position.set(0, 0.018, 0);
    group.add(armMesh);

    const m = motor(0.0115, 0.015, i % 2 === 0 ? 0x8a2f27 : 0x2f5e8a);
    m.position.set(cx, 0.02, cz);
    group.add(m);

    const prop = makeProp(0.0635, 0x30333a);
    prop.pivot.position.set(cx, 0.042, cz);
    prop.spinSign = (i === 0 || i === 3) ? -1 : 1; // visual spin direction
    group.add(prop.pivot);
    props.push(prop);
    motorPositions.push(new THREE.Vector3(cx, 0.042, cz));
  });

  // FPV camera (tilted up 25deg) at nose (-Z)
  const camMount = new THREE.Group();
  camMount.position.set(0, 0.038, -0.062);
  camMount.rotation.x = 0.436; // 25 deg up-tilt
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.019, 0.017), darkPlastic);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0075, 0.008, 12),
    new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.15, metalness: 0.4 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.011;
  const lensGlass = new THREE.Mesh(new THREE.CircleGeometry(0.005, 12),
    new THREE.MeshStandardMaterial({ color: 0x2244cc, roughness: 0.05, metalness: 0.9, emissive: 0x112266, emissiveIntensity: 0.4 }));
  lensGlass.position.z = -0.0155;
  lensGlass.rotation.y = Math.PI;
  camMount.add(camBody, lens, lensGlass);
  group.add(camMount);

  // battery on top with straps
  const batt = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.03, 0.036),
    new THREE.MeshStandardMaterial({ color: 0x11131a, roughness: 0.55 }));
  batt.position.set(0, 0.063, 0.012);
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.9 });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.032, 0.006), strapMat);
  strap.position.copy(batt.position);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x39ff88 }));
  label.position.set(0.037, 0.063, 0.012);
  label.rotation.y = Math.PI / 2;
  group.add(batt, strap, label);

  // VTX antenna (tail)
  const antMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.5 });
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0022, 0.055, 6), antMat);
  ant.position.set(0.018, 0.055, 0.06);
  ant.rotation.x = 0.35;
  const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.3 }));
  antTip.position.set(0.018, 0.083, 0.069);
  group.add(ant, antTip);

  // nav LEDs: left red, right green, tail white
  const ledGeo = new THREE.BoxGeometry(0.008, 0.002, 0.014);
  const ledL = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 2.2 }));
  ledL.position.set(-a + 0.01, 0.02, 0.02);
  const ledR = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x20ff40, emissiveIntensity: 2.2 }));
  ledR.position.set(a - 0.01, 0.02, 0.02);
  const ledT = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.002, 0.006),
    new THREE.MeshStandardMaterial({ color: 0x222200, emissive: 0xffcc33, emissiveIntensity: 1.6 }));
  ledT.position.set(0, 0.02, 0.062);
  group.add(ledL, ledR, ledT);

  // payload mount under belly
  const payloadMount = new THREE.Group();
  payloadMount.position.set(0, 0.008, 0);
  group.add(payloadMount);

  // downward camera pod
  const bellyMount = makeBellyCam(-0.03, -0.035);
  group.add(bellyMount);

  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });

  return { group, props, cameraMount: camMount, bellyMount, payloadMount, motorPositions };
}

// ---------------- MAV recon VTOL ----------------
export function buildMAV(): DroneBuild {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.4, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5 });

  // fuselage
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 6, 12), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.07;
  body.scale.set(1.15, 0.75, 1);
  group.add(body);
  // top shell stripe
  const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.19, 6, 12), darkMat);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = 0.082;
  stripe.scale.set(0.9, 0.5, 0.96);
  group.add(stripe);

  // arms: front swept-forward, rear swept-back
  const arm = 0.17;
  const a = arm * Math.SQRT1_2;
  const corners: [number, number][] = [[-a, -a], [a, -a], [-a, a], [a, a]]; // FL FR BL BR
  const props: PropRef[] = [];
  const motorPositions: THREE.Vector3[] = [];
  const armGeo = new THREE.CylinderGeometry(0.009, 0.012, 0.13, 8);
  corners.forEach(([cx, cz], i) => {
    const armMesh = new THREE.Mesh(armGeo, bodyMat);
    const angle = Math.atan2(cx, -cz);
    armMesh.position.set(cx * 0.55, 0.07, cz * 0.55);
    armMesh.rotation.z = Math.PI / 2;
    armMesh.rotation.y = -angle;
    group.add(armMesh);

    const m = motor(0.014, 0.018, 0x4a4d52);
    m.position.set(cx, 0.075, cz);
    group.add(m);

    const prop = makeProp(0.1175, 0x2a2d33);
    prop.pivot.position.set(cx, 0.1, cz);
    prop.spinSign = (i === 0 || i === 3) ? -1 : 1;
    group.add(prop.pivot);
    props.push(prop);
    motorPositions.push(new THREE.Vector3(cx, 0.1, cz));
  });

  // gimbal camera under nose
  const gimbal = new THREE.Group();
  gimbal.position.set(0, 0.035, -0.115);
  const gimbalBall = new THREE.Mesh(new THREE.SphereGeometry(0.021, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.35, metalness: 0.4 }));
  const gLens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.01, 12),
    new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.1, metalness: 0.5 }));
  gLens.rotation.x = Math.PI / 2;
  gLens.position.set(0, 0, -0.018);
  const gGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0068, 12),
    new THREE.MeshStandardMaterial({ color: 0x1a3a88, roughness: 0.05, metalness: 0.9, emissive: 0x0a1a44, emissiveIntensity: 0.5 }));
  gGlass.position.set(0, 0, -0.0235);
  gGlass.rotation.y = Math.PI;
  gimbal.add(gimbalBall, gLens, gGlass);
  group.add(gimbal);

  // obstacle sensors (front eyes)
  for (const sx of [-0.028, 0.028]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), darkMat);
    eye.position.set(sx, 0.075, -0.132);
    group.add(eye);
  }

  // landing legs
  const legGeo = new THREE.CylinderGeometry(0.003, 0.0035, 0.05, 6);
  for (const [lx, lz] of [[-0.05, -0.06], [0.05, -0.06], [-0.05, 0.09], [0.05, 0.09]]) {
    const leg = new THREE.Mesh(legGeo, darkMat);
    leg.position.set(lx, 0.025, lz);
    group.add(leg);
  }

  // nav LEDs: front arms red, rear green
  const mkLed = (color: number) => new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 2.5 }));
  const lFL = mkLed(0xff2222); lFL.position.set(-a, 0.075, -a + 0.02);
  const lFR = mkLed(0xff2222); lFR.position.set(a, 0.075, -a + 0.02);
  const lBL = mkLed(0x22ff44); lBL.position.set(-a, 0.075, a - 0.02);
  const lBR = mkLed(0x22ff44); lBR.position.set(a, 0.075, a - 0.02);
  group.add(lFL, lFR, lBL, lBR);

  const payloadMount = new THREE.Group();
  payloadMount.position.set(0, 0.045, 0.04);
  group.add(payloadMount);

  // downward camera pod
  const bellyMount = makeBellyCam(0.02, 0.06);
  group.add(bellyMount);

  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });

  return { group, props, cameraMount: gimbal, bellyMount, gimbal, payloadMount, motorPositions };
}
