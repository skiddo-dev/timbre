import { KERNEL_BYTES } from './kernel-bytes';

/**
 * Runtime wrapper around the hand-authored loudness/DSP kernel (see
 * scripts/gen-wasm-kernels.mjs). These are the per-track hot loops of the
 * loudness scan; the module compiles once and each call gets a fresh, right-sized
 * linear memory. `*JS` are byte-for-byte fallbacks the generator asserts agree
 * exactly, used if WASM is somehow unavailable.
 */
const PAGE = 65_536;
let compiled: WebAssembly.Module | null = null;
function mod(): WebAssembly.Module {
	if (!compiled) compiled = new WebAssembly.Module(new Uint8Array(KERNEL_BYTES));
	return compiled;
}
function instance(byteLen: number) {
	const mem = new WebAssembly.Memory({ initial: Math.ceil(byteLen / PAGE) + 1 });
	const inst = new WebAssembly.Instance(mod(), { env: { mem } });
	return { mem, inst };
}

export type BiquadCoeffs = [b0: number, b1: number, b2: number, a1: number, a2: number];

/** Apply a direct-form-I biquad over mono f32 PCM (fresh zero state). */
export function biquad(input: Float32Array, c: BiquadCoeffs): Float32Array {
	const n = input.length;
	if (n === 0) return new Float32Array(0);
	try {
		const { mem, inst } = instance((n * 2 + 4) * 4);
		new Float32Array(mem.buffer, 0, n).set(input);
		const statePtr = n * 4;
		const outPtr = n * 4 + 16;
		new Float32Array(mem.buffer, statePtr, 4).fill(0);
		(inst.exports.biquad as (i: number, n: number, b0: number, b1: number, b2: number, a1: number, a2: number, s: number, o: number) => void)(
			0, n, c[0], c[1], c[2], c[3], c[4], statePtr, outPtr
		);
		return new Float32Array(mem.buffer, outPtr, n).slice();
	} catch {
		return biquadJS(input, c);
	}
}

/** Per-block mean-square (sliding window). */
export function blockPower(input: Float32Array, frame: number, hop: number): Float32Array {
	const n = input.length;
	if (n < frame) return new Float32Array(0);
	try {
		const maxF = Math.trunc((n - frame) / hop) + 1;
		const { mem, inst } = instance((n + maxF) * 4);
		new Float32Array(mem.buffer, 0, n).set(input);
		const m = (inst.exports.blockPower as (i: number, n: number, f: number, h: number, o: number) => number)(
			0, n, frame, hop, n * 4
		);
		return new Float32Array(mem.buffer, n * 4, m).slice();
	} catch {
		return blockPowerJS(input, frame, hop);
	}
}

/** Max |sample| (sample peak). */
export function peak(input: Float32Array): number {
	const n = input.length;
	if (n === 0) return 0;
	try {
		const { mem, inst } = instance(n * 4);
		new Float32Array(mem.buffer, 0, n).set(input);
		return (inst.exports.peak as (i: number, n: number) => number)(0, n);
	} catch {
		return peakJS(input);
	}
}

/** Per-bucket max |sample| for the waveform overview. */
export function waveformPeaks(input: Float32Array, buckets: number): Float32Array {
	const n = input.length;
	const b = Math.max(1, Math.min(buckets, n));
	if (n === 0) return new Float32Array(0);
	try {
		const { mem, inst } = instance((n + b) * 4);
		new Float32Array(mem.buffer, 0, n).set(input);
		(inst.exports.waveformPeaks as (i: number, n: number, k: number, o: number) => void)(0, n, b, n * 4);
		return new Float32Array(mem.buffer, n * 4, b).slice();
	} catch {
		return waveformPeaksJS(input, b);
	}
}

// ── JS twins (kept bit-exact by the generator's self-check) ──────────────────
const fr = Math.fround;
export function biquadJS(input: Float32Array, c: BiquadCoeffs): Float32Array {
	const n = input.length;
	const out = new Float32Array(n);
	const b0 = fr(c[0]), b1 = fr(c[1]), b2 = fr(c[2]), a1 = fr(c[3]), a2 = fr(c[4]);
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	for (let i = 0; i < n; i++) {
		const x = input[i];
		let y = fr(b0 * x);
		y = fr(y + fr(b1 * x1));
		y = fr(y + fr(b2 * x2));
		y = fr(y - fr(a1 * y1));
		y = fr(y - fr(a2 * y2));
		out[i] = y;
		x2 = x1; x1 = x; y2 = y1; y1 = y;
	}
	return out;
}
export function blockPowerJS(input: Float32Array, frame: number, hop: number): Float32Array {
	const n = input.length;
	const nF = n >= frame ? Math.trunc((n - frame) / hop) + 1 : 0;
	const out = new Float32Array(nF);
	for (let f = 0; f < nF; f++) {
		const start = f * hop;
		let sum = 0;
		for (let k = 0; k < frame; k++) { const x = input[start + k]; sum = fr(sum + fr(x * x)); }
		out[f] = fr(sum / fr(frame));
	}
	return out;
}
export function peakJS(input: Float32Array): number {
	let best = 0;
	for (let i = 0; i < input.length; i++) { const x = Math.abs(input[i]); if (x > best) best = x; }
	return fr(best);
}
export function waveformPeaksJS(input: Float32Array, buckets: number): Float32Array {
	const n = input.length;
	const bsize = Math.trunc(n / buckets);
	const out = new Float32Array(buckets);
	for (let b = 0; b < buckets; b++) {
		const start = b * bsize;
		let best = 0;
		for (let k = 0; k < bsize; k++) { const x = Math.abs(input[start + k]); if (x > best) best = x; }
		out[b] = fr(best);
	}
	return out;
}
