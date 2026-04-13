// utils.js
// Utility functions, Perlin noise, etc.

export const PerlinNoise = new function() {
    this.p = new Uint8Array(512);
    this.seed = (s) => {
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 255; i > 0; i--) { const n = Math.floor((i + 1) * s()); const t = this.p[i]; this.p[i] = this.p[n]; this.p[n] = t; }
        for (let i = 0; i < 256; i++) this.p[i + 256] = this.p[i];
    };
    const grad3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
    const dot = (g, x, y) => g[0] * x + g[1] * y;
    this.simplex2 = (x, y) => {
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0), G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const s = (x + y) * F2;
        const i = Math.floor(x + s), j = Math.floor(y + s);
        const t = (i + j) * G2;
        const X0 = i - t, Y0 = j - t;
        const x0 = x - X0, y0 = y - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2, y2 = y0 - 1.0 + 2.0 * G2;
        const ii = i & 255, jj = j & 255;
        let n0, n1, n2;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) n0 = 0.0; else { t0 *= t0; n0 = t0 * t0 * dot(grad3[this.p[ii + this.p[jj]] % 12], x0, y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0; else { t1 *= t1; n1 = t1 * t1 * dot(grad3[this.p[ii + i1 + this.p[jj + j1]] % 12], x1, y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0; else { t2 *= t2; n2 = t2 * t2 * dot(grad3[this.p[ii + 1 + this.p[jj + 1]] % 12], x2, y2); }
        return 70.0 * (n0 + n1 + n2);
    };
};
