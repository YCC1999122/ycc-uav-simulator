import * as THREE from 'three';

// Late-afternoon sky, sun, fog and shadow-following sun light
export class Sky {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  skyDome: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.FogExp2(0xcfd8d6, 0.00085);
    scene.background = new THREE.Color(0xb2c7d8);

    // gradient sky dome
    const geo = new THREE.SphereGeometry(3000, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4d80b8) },
        horizonColor: { value: new THREE.Color(0xe2e8e6) },
        sunDir: { value: new THREE.Vector3(0.5, 0.35, 0.4).normalize() },
        sunColor: { value: new THREE.Color(0xfff2d8) }
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 topColor, horizonColor, sunColor;
        uniform vec3 sunDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += sunColor * (pow(s, 600.0) * 1.6 + pow(s, 24.0) * 0.28);
          // subtle haze band
          col = mix(col, horizonColor * 0.98, exp(-h * 9.0) * 0.4);
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    this.skyDome = new THREE.Mesh(geo, mat);
    scene.add(this.skyDome);

    this.sun = new THREE.DirectionalLight(0xfff3dc, 3.3);
    this.sun.position.set(180, 130, 100);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 500;
    const s = 120;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xb4cfe8, 0x8f9070, 1.25);
    scene.add(this.hemi);

    // low clouds: soft billboards
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xe8ecee, transparent: true, opacity: 0.55, depthWrite: false, fog: false
    });
    const cloudGeo = new THREE.CircleGeometry(1, 12);
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(cloudGeo, cloudMat);
      const scale = 90 + Math.random() * 220;
      c.scale.set(scale, scale * 0.28, 1);
      c.position.set((Math.random() - 0.5) * 2600, 240 + Math.random() * 220, (Math.random() - 0.5) * 2600);
      c.rotation.x = -Math.PI / 2;
      c.rotation.z = Math.random() * Math.PI;
      scene.add(c);
    }
  }

  // shadow camera follows the drone so nearby shadows stay sharp
  follow(p: THREE.Vector3) {
    this.sun.position.set(p.x + 180, p.y + 130, p.z + 100);
    this.sun.target.position.copy(p);
    this.skyDome.position.copy(p);
  }
}
