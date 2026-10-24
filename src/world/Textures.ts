import * as THREE from 'three';
import { fbm2, noise2 } from '../core/utils';

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function carbonFiber(): THREE.CanvasTexture {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#15161a';
    ctx.fillRect(0, 0, s, s);
    const cell = 8;
    for (let y = 0; y < s / cell; y++) {
      for (let x = 0; x < s / cell; x++) {
        const even = (x + y) % 2 === 0;
        const g = ctx.createLinearGradient(x * cell, y * cell, even ? (x + 1) * cell : x * cell, even ? y * cell : (y + 1) * cell);
        g.addColorStop(0, '#1e2026');
        g.addColorStop(0.5, '#34373f');
        g.addColorStop(1, '#131418');
        ctx.fillStyle = g;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  });
}

export function grass(): THREE.CanvasTexture {
  return canvasTex(1024, (ctx, s) => {
    ctx.fillStyle = '#5c7242';
    ctx.fillRect(0, 0, s, s);
    // large patchiness
    for (let i = 0; i < 7000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const n = fbm2(x * 0.005, y * 0.005, 3);
      const g = 94 + n * 46 + Math.random() * 34;
      ctx.fillStyle = `rgb(${(g * 0.78) | 0},${(g * 1.08) | 0},${(g * 0.5) | 0})`;
      ctx.globalAlpha = 0.22 + Math.random() * 0.35;
      const r = 3 + Math.random() * 18;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // dry patches
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      ctx.fillStyle = `rgb(${152 + Math.random() * 40 | 0},${128 + Math.random() * 30 | 0},78)`;
      ctx.globalAlpha = 0.05 + Math.random() * 0.11;
      ctx.beginPath(); ctx.arc(x, y, 12 + Math.random() * 40, 0, 7); ctx.fill();
    }
    // speckle blades — fine detail so low passes look crisp
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 34000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = Math.random();
      ctx.fillStyle = v > 0.66 ? '#86a65c' : v > 0.33 ? '#6b8752' : '#516b3a';
      ctx.globalAlpha = 0.35 + Math.random() * 0.4;
      ctx.fillRect(x, y, 1.3, 4 + Math.random() * 5);
    }
    // small stones
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 900; i++) {
      const v = 95 + Math.random() * 60 | 0;
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.4, 1 + Math.random() * 1.6, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

// single grass-tuft card (alpha) for instanced 3D blades
export function grassBlade(): THREE.CanvasTexture {
  return canvasTex(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 15; i++) {
      const x = 10 + Math.random() * (s - 20);
      const w = 2.5 + Math.random() * 3.5;
      const h = s * (0.55 + Math.random() * 0.45);
      const hue = 68 + Math.random() * 34;
      const g = ctx.createLinearGradient(0, s, 0, s - h);
      g.addColorStop(0, `hsl(${hue}, 48%, 20%)`);
      g.addColorStop(1, `hsl(${hue + 14}, 58%, ${40 + Math.random() * 18}%)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - w, s);
      ctx.quadraticCurveTo(x - w * 0.4, s - h * 0.6, x + (Math.random() - 0.5) * 16, s - h);
      ctx.quadraticCurveTo(x + w * 0.5, s - h * 0.55, x + w, s);
      ctx.closePath(); ctx.fill();
    }
  });
}

export function dirt(): THREE.CanvasTexture {
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#7e6c52';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 6400; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const v = 102 + noise2(x * 0.025, y * 0.025) * 40 + Math.random() * 30;
      ctx.fillStyle = `rgb(${v | 0},${v * 0.8 | 0},${v * 0.58 | 0})`;
      ctx.globalAlpha = 0.26;
      ctx.beginPath(); ctx.arc(x, y, 1 + Math.random() * 6, 0, 7); ctx.fill();
    }
    // embedded gravel / ruts
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 1400; i++) {
      const v = 120 + Math.random() * 70 | 0;
      ctx.fillStyle = `rgb(${v},${v * 0.94 | 0},${v * 0.82 | 0})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

export function concrete(): THREE.CanvasTexture {
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#8d8d88';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 12000; i++) {
      const v = 110 + Math.random() * 60;
      ctx.fillStyle = `rgb(${v},${v},${v - 4})`;
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, 0.5 + Math.random() * 4, 0, 7); ctx.fill();
    }
    // weathering stains
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = 'rgba(78,76,70,0.10)';
      ctx.beginPath();
      ctx.ellipse(Math.random() * s, Math.random() * s, 12 + Math.random() * 50, 8 + Math.random() * 30, Math.random() * 3, 0, 7);
      ctx.fill();
    }
    // cracks
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#5c5c58';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = Math.random() * s, y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

export function camo(): THREE.CanvasTexture {
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#4b5436';
    ctx.fillRect(0, 0, s, s);
    const colors = ['#3a4030', '#5d6440', '#6e6248', '#2e3324'];
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.85;
      const x = Math.random() * s, y = Math.random() * s;
      ctx.beginPath();
      for (let a = 0; a < 6.3; a += 0.7) {
        const r = 22 + Math.random() * 48;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.6;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

// chain-link / camouflage netting panel: transparent weave used by the
// interception screens scattered around the range
export function netting(): THREE.CanvasTexture {
  const t = canvasTex(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(48,54,44,0.9)';
    ctx.lineWidth = 2.4;
    for (let i = -s; i < s * 2; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, s); ctx.lineTo(i + s, 0); ctx.stroke();
    }
    // horizontal tie wires
    ctx.strokeStyle = 'rgba(70,76,64,0.8)';
    ctx.lineWidth = 3;
    for (let y = 4; y < s; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// radial swirl alpha texture for spinning prop blur
export function propBlur(): THREE.CanvasTexture {
  const t = canvasTex(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    for (let i = 0; i < 360; i += 2) {
      const a = i * Math.PI / 180;
      const alpha = 0.05 + 0.16 * Math.pow(Math.abs(Math.sin(i * 1.5 * Math.PI / 180 + 0.6)), 1.5);
      ctx.strokeStyle = `rgba(30,32,36,${alpha})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * s * 0.1, cx + Math.sin(a) * s * 0.1);
      ctx.lineTo(cx + Math.cos(a + 0.35) * s * 0.48, cx + Math.sin(a + 0.35) * s * 0.48);
      ctx.stroke();
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function helipad(): THREE.CanvasTexture {
  const t = canvasTex(512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(230,230,225,0.9)';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.42, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(230,230,225,0.92)';
    ctx.font = `bold ${s * 0.5}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', s / 2, s / 2 + s * 0.02);
  });
  return t;
}

export function metal(color = '#9aa0a6'): THREE.CanvasTexture {
  return canvasTex(128, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const v = (Math.random() - 0.5) * 22;
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
      ctx.fillRect(0, y, s, 1);
    }
  });
}
