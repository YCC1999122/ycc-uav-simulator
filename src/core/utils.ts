// Math & noise utilities
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg = (r: number) => r * 180 / Math.PI;
export const rad = (d: number) => d * Math.PI / 180;

// Gaussian random (Box-Muller)
export function gauss(sigma = 1): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

// Ornstein-Uhlenbeck process (mean-reverting random walk, for GPS drift)
export class OU {
  private x = 0;
  constructor(private theta: number, private sigma: number) {}
  step(dt: number): number {
    this.x += -this.theta * this.x * dt + this.sigma * Math.sqrt(dt) * gauss();
    return this.x;
  }
  get value() { return this.x; }
}

// 2D value noise (deterministic, for terrain & gusts)
const PERM = new Uint8Array(512);
(() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function hash2(x: number, y: number): number {
  return PERM[(PERM[x & 255] + y) & 255] / 255;
}
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export function fbm2(x: number, y: number, oct = 4): number {
  let amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise2(x * f, y * f); amp *= 0.5; f *= 2; }
  return sum;
}

// Exponential smoothing
export class Smoother {
  private v: number;
  constructor(private rate: number, initial = 0) { this.v = initial; }
  update(target: number, dt: number): number {
    this.v += (target - this.v) * (1 - Math.exp(-this.rate * dt));
    return this.v;
  }
  get value() { return this.v; }
}
