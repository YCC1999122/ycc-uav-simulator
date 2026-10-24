// YCC boot / initialisation screen controller.
// Drives the staged start-up: every subsystem appends a log row while the
// progress bar advances, then the overlay fades out once the sim is ready.
export class BootScreen {
  private root = document.getElementById('boot');
  private fill = document.getElementById('boot-fill');
  private pctEl = document.getElementById('boot-pct');
  private logEl = document.getElementById('boot-log');
  private row: HTMLElement | null = null;
  private t0 = performance.now();

  async step(en: string, zh: string, pct: number) {
    if (!this.root) return;
    if (this.row) this.markRow(this.row);
    const row = document.createElement('div');
    row.className = 'boot-row';
    row.innerHTML =
      `<span class="boot-k">INIT</span><span class="boot-en">${en}</span>` +
      `<span class="boot-zh">${zh}</span><span class="boot-st">RUN</span>`;
    this.logEl?.appendChild(row);
    if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight;
    this.row = row;
    if (this.fill) this.fill.style.width = `${pct}%`;
    if (this.pctEl) this.pctEl.textContent = `${String(pct).padStart(2, '0')}%`;
    await this.paint();
  }

  private markRow(row: HTMLElement) {
    row.classList.add('ok');
    const k = row.querySelector('.boot-k');
    if (k) k.textContent = 'OK';
    const st = row.querySelector('.boot-st');
    if (st) st.textContent = 'DONE';
  }

  // resolves after the browser had a chance to paint; the timeout keeps the
  // start-up moving when rAF is throttled (background tab / headless capture)
  private paint() {
    return new Promise<void>(resolve => {
      let done = false;
      const go = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(go));
      setTimeout(go, 160);
    });
  }

  async finish() {
    if (!this.root) return;
    if (this.row) this.markRow(this.row);
    if (this.fill) this.fill.style.width = '100%';
    if (this.pctEl) this.pctEl.textContent = '100%';
    const foot = document.querySelector('.boot-foot');
    if (foot) foot.textContent = `准备就绪 READY — ${((performance.now() - this.t0) / 1000).toFixed(1)}s`;
    await new Promise(r => setTimeout(r, 480));
    this.root.classList.add('out');
    setTimeout(() => { if (this.root) this.root.style.display = 'none'; }, 700);
  }

  fail(err: unknown) {
    if (!this.root) return;
    if (this.fill) {
      this.fill.style.width = '100%';
      this.fill.style.background = 'linear-gradient(90deg, #7a1d1d, #ff4d4d)';
      this.fill.style.boxShadow = '0 0 14px rgba(255,77,77,.8)';
    }
    if (this.pctEl) { this.pctEl.textContent = 'ERR'; this.pctEl.style.color = '#ff4d4d'; }
    const foot = document.querySelector('.boot-foot');
    if (foot) foot.textContent = '初始化失败 INIT FAILED — 按 F12 查看控制台';
    console.error('[YCC boot] init failed', err);
  }
}
