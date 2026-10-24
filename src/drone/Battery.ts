// LiPo battery model: SOC tracking, voltage curve, current sag
export class Battery {
  cells: number;
  capacityMah: number;
  internalRPerCell = 0.012; // ohm
  soc = 1.0;                // 0..1
  currentDraw = 0;          // A
  idleDraw: number;         // electronics idle current

  constructor(cells: number, capacityMah: number, idleDraw = 0.8) {
    this.cells = cells;
    this.capacityMah = capacityMah;
    this.idleDraw = idleDraw;
  }

  // update with per-motor load fraction [0..1]
  update(dt: number, motorLoad: number[]) {
    // current roughly quadratic with motor load
    let load = 0;
    for (const l of motorLoad) load += l * l;
    // realistic draw: 5" FPV ~40A full-stick / ~10A cruise, MAV ~16A max
    const maxCurrent = this.capacityMah > 3000 ? 16 : 42; // A
    this.currentDraw = this.idleDraw + load / motorLoad.length * maxCurrent;
    this.soc -= this.currentDraw / (this.capacityMah / 1000 * 3600) * dt;
    if (this.soc < 0) this.soc = 0;
  }

  // rested pack voltage (no load)
  get nominalVoltage(): number {
    // per-cell curve: 4.2 full -> ~3.5 knee -> 3.0 empty
    const s = this.soc;
    const perCell = 3.3 + 0.9 * (s <= 0.15 ? s / 0.15 * 0.25 + 0 : 0.25 + ((s - 0.15) / 0.85) * 0.75);
    return perCell * this.cells;
  }

  // voltage under load (sag)
  get voltage(): number {
    return this.nominalVoltage - this.currentDraw * this.internalRPerCell * this.cells;
  }

  get lowWarning(): boolean { return this.voltage < this.cells * 3.55; }
  get critical(): boolean { return this.voltage < this.cells * 3.35; }

  reset() { this.soc = 1.0; this.currentDraw = 0; }
}
