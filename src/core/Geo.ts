// Local ENU <-> WGS84 conversion around a fictional training-range origin
export class Geo {
  lat0: number; lon0: number;
  private metersPerDegLat: number;
  private metersPerDegLon: number;

  constructor(lat0 = 48.4297, lon0 = 37.9703) {
    this.lat0 = lat0; this.lon0 = lon0;
    const latRad = lat0 * Math.PI / 180;
    this.metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
    this.metersPerDegLon = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
  }

  // world: +x east, -z north
  toLatLon(x: number, z: number): { lat: number; lon: number } {
    return {
      lat: this.lat0 + (-z) / this.metersPerDegLat,
      lon: this.lon0 + x / this.metersPerDegLon
    };
  }

  toWorld(lat: number, lon: number): { x: number; z: number } {
    return {
      x: (lon - this.lon0) * this.metersPerDegLon,
      z: -(lat - this.lat0) * this.metersPerDegLat
    };
  }

  format(x: number, z: number): string {
    const { lat, lon } = this.toLatLon(x, z);
    const la = Math.abs(lat), lo = Math.abs(lon);
    const laD = Math.floor(la), laM = (la - laD) * 60;
    const loD = Math.floor(lo), loM = (lo - loD) * 60;
    return `${laD}°${laM.toFixed(3)}'N ${loD}°${loM.toFixed(3)}'E`;
  }
}
