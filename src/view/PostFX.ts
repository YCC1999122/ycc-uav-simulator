import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// FPV video-link shader: fisheye, noise, tearing, chromatic aberration, vignette
const FPVShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uNoise: { value: 0.03 },
    uTear: { value: 0 },
    uFisheye: { value: 0.55 },
    uEnabled: { value: 1 },
    uBlackout: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uNoise, uTear, uFisheye, uEnabled, uBlackout;
    varying vec2 vUv;

    vec2 fisheye(vec2 uv, float k) {
      vec2 c = uv - 0.5;
      float r = length(c);
      float rd = r * (1.0 + k * r * r);
      return 0.5 + c * (rd / max(r, 1e-5));
    }
    float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      if (uEnabled > 0.5) {
        uv = fisheye(uv, uFisheye);
        float row = floor(uv.y * 240.0);
        float tearLine = step(1.0 - uTear * 0.05, rnd(vec2(row, floor(uTime * 30.0))));
        uv.x += tearLine * (rnd(vec2(uTime, row)) - 0.5) * 0.2 * uTear;
        uv.y += uTear * 0.015 * sin(uTime * 2.5 + uv.x * 6.0);
      }
      vec2 d = (uv - 0.5) * 0.004 * uEnabled;
      float rC = texture2D(tDiffuse, uv + d).r;
      float gC = texture2D(tDiffuse, uv).g;
      float bC = texture2D(tDiffuse, uv - d).b;
      vec3 col = vec3(rC, gC, bC);

      float n = rnd(uv * vec2(1920.0, 1080.0) + uTime * 97.0);
      col += (n - 0.5) * uNoise;
      col *= 1.0 - uEnabled * 0.05 * sin(uv.y * 900.0);
      col = mix(col, col * vec3(0.92, 1.05, 0.95), uEnabled * 0.3);
      float vig = smoothstep(0.98, 0.32, length(vUv - 0.5));
      col *= mix(1.0, vig, uEnabled * 0.75 + 0.08);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
      // signal blackout: rolling noise then dark
      col = mix(col, vec3(n * 0.25), clamp(uBlackout, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }`
};

// subtle grade for observer views
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.35 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVig; varying vec2 vUv;
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col = (col - 0.5) * 1.06 + 0.5;                 // contrast
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.08);                   // saturation
      col *= smoothstep(1.05, 0.35, length(vUv - 0.5)) * uVig + (1.0 - uVig);
      gl_FragColor = vec4(col, 1.0);
    }`
};

export class PostFX {
  composer: EffectComposer;
  fpvPass: ShaderPass;
  private bloom: UnrealBloomPass;
  private renderPass: RenderPass;
  private gradePass: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.85);
    this.fpvPass = new ShaderPass(FPVShader);
    this.gradePass = new ShaderPass(GradeShader);
    const output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.fpvPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(output);
    this.fpvPass.enabled = false;
  }

  setCamera(cam: THREE.Camera) { this.renderPass.camera = cam; }

  setFPV(enabled: boolean) { this.fpvPass.enabled = enabled; }

  // linkQuality 0..1
  updateLink(dt: number, t: number, quality: number, digital: boolean) {
    const u = this.fpvPass.uniforms;
    u.uTime.value = t;
    const bad = 1 - quality;
    if (digital) {
      // DJI-style: blocky freeze handled by blackout steps; low noise but hard cutoff
      u.uNoise.value = 0.02 + bad * bad * 0.35;
      u.uTear.value = bad > 0.55 ? (bad - 0.55) * 2.2 : 0;
      u.uBlackout.value = quality < 0.12 ? 0.85 : 0;
    } else {
      u.uNoise.value = 0.04 + bad * bad * 0.55;
      u.uTear.value = bad * bad * 1.4;
      u.uBlackout.value = quality < 0.1 ? 0.9 : Math.max(0, bad - 0.85) * 2;
    }
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); }
  render(dt: number) { this.composer.render(dt); }
}
