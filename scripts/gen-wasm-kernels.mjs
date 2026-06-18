#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gen-wasm-kernels.mjs — hand-author Timbre's WebAssembly loudness/DSP kernel.
//
// No Rust / emscripten / wat2wasm toolchain: we emit the module's bytes directly
// with a tiny in-file assembler, instantiate it in Node to PROVE each kernel
// matches an f32 JS reference bit-for-bit, and commit the result as a base64
// module the app imports (plus a .wasm static asset for inspection).
//
//   node scripts/gen-wasm-kernels.mjs      # build + verify + write
//   npm run gen:wasm
//
// The module imports linear memory from JS (JS owns sizing + readback) and exports
// the four hot loops of the loudness scan (a track is millions of samples):
//
//   biquad(ptrIn, n, b0,b1,b2,a1,a2, ptrState, ptrOut) -> ()
//     Direct-form-I biquad. State (x1,x2,y1,y2 as 4×f32) lives at ptrState. Used
//     twice in series for the BS.1770 "K-weighting" pre-filter before loudness.
//
//   blockPower(ptrIn, n, frame, hop, ptrOut) -> i32   (returns block count)
//     Per-block mean-square (sliding window). One f32 per block; the R128 gating
//     in loudness.ts runs over this small array.
//
//   peak(ptrIn, n) -> f32          Max |sample| (sample-peak, for clip headroom).
//   waveformPeaks(ptrIn, n, buckets, ptrOut) -> ()   Per-bucket max |sample| for
//     the seek-bar waveform overview.
//
//   yencDecode(ptrIn, n, ptrOut) -> i32   (returns decoded byte count)
//     yEnc binary decode for Usenet article bodies (the Usenet downloader's hot
//     loop — a single album part is millions of bytes). Byte-oriented, not f32.
//
// Each kernel's JS twin lives below (f32 / u8 throughout) and is asserted
// bit-exact against the wasm across several fixtures.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_WASM = join(ROOT, 'static', 'kernels', 'timbre-kernels.wasm')
const OUT_BYTES = join(ROOT, 'src', 'lib', 'wasm', 'kernel-bytes.ts')
const OUT_VERSION = join(ROOT, 'src', 'lib', 'wasm', 'kernel-version.ts')

// ── tiny binary helpers ──────────────────────────────────────────────────────
const uleb = (n) => {
  const out = []
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b) } while (n)
  return out
}
const sleb = (n) => {
  const out = []
  let more = true
  while (more) {
    let b = n & 0x7f; n >>= 7
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) more = false
    else b |= 0x80
    out.push(b)
  }
  return out
}
const f32bytes = (x) => {
  const dv = new DataView(new ArrayBuffer(4))
  dv.setFloat32(0, x, true)
  return [...new Uint8Array(dv.buffer)]
}
const str = (s) => { const b = [...Buffer.from(s, 'utf8')]; return [...uleb(b.length), ...b] }
const section = (id, payload) => [id, ...uleb(payload.length), ...payload]
const vec = (items) => [...uleb(items.length), ...items.flat()]

const I32 = 0x7f
const F32 = 0x7d

const OP = {
  block: 0x02, loop: 0x03, if: 0x04, else: 0x05, end: 0x0b, br: 0x0c, br_if: 0x0d,
  call: 0x10, select: 0x1b,
  localGet: 0x20, localSet: 0x21, localTee: 0x22,
  i32Const: 0x41, f32Const: 0x43,
  f32Load: 0x2a, f32Store: 0x38,
  i32Load8U: 0x2d, i32Store8: 0x3a,
  i32Add: 0x6a, i32Sub: 0x6b, i32Mul: 0x6c, i32DivS: 0x6d, i32Shl: 0x74,
  i32Eq: 0x46, i32LtS: 0x48, i32GeS: 0x4e,
  f32Abs: 0x8b, f32Sqrt: 0x91, f32Add: 0x92, f32Sub: 0x93, f32Mul: 0x94, f32Div: 0x95,
  f32Min: 0x96, f32Max: 0x97,
  i32TruncF32S: 0xa8, f32ConvertI32S: 0xb2,
  EMPTY: 0x40,
}

function emitter() {
  const B = []
  return {
    B,
    get: (i) => B.push(OP.localGet, ...uleb(i)),
    set: (i) => B.push(OP.localSet, ...uleb(i)),
    ic: (n) => B.push(OP.i32Const, ...sleb(n)),
    fc: (x) => B.push(OP.f32Const, ...f32bytes(x)),
    op: (...c) => B.push(...c),
  }
}

// ── biquad(): direct-form-I, state in memory ─────────────────────────────────
function buildBiquad() {
  const P = { ptrIn: 0, nIn: 1, b0: 2, b1: 3, b2: 4, a1: 5, a2: 6, ptrState: 7, ptrOut: 8 }
  const L = { i: 9, x: 10, x1: 11, x2: 12, y1: 13, y2: 14, y: 15 }
  const { B, get, set, ic, op } = emitter()

  // load state
  get(P.ptrState); op(OP.f32Load, 2, 0); set(L.x1)
  get(P.ptrState); op(OP.f32Load, 2, 4); set(L.x2)
  get(P.ptrState); op(OP.f32Load, 2, 8); set(L.y1)
  get(P.ptrState); op(OP.f32Load, 2, 12); set(L.y2)

  ic(0); set(L.i)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.i); get(P.nIn); op(OP.i32GeS); op(OP.br_if, 1)
  // x = in[i]
  get(P.ptrIn); get(L.i); ic(2); op(OP.i32Shl); op(OP.i32Add); op(OP.f32Load, 2, 0); set(L.x)
  // y = b0*x
  get(P.b0); get(L.x); op(OP.f32Mul); set(L.y)
  // y = y + b1*x1
  get(L.y); get(P.b1); get(L.x1); op(OP.f32Mul); op(OP.f32Add); set(L.y)
  // y = y + b2*x2
  get(L.y); get(P.b2); get(L.x2); op(OP.f32Mul); op(OP.f32Add); set(L.y)
  // y = y - a1*y1
  get(L.y); get(P.a1); get(L.y1); op(OP.f32Mul); op(OP.f32Sub); set(L.y)
  // y = y - a2*y2
  get(L.y); get(P.a2); get(L.y2); op(OP.f32Mul); op(OP.f32Sub); set(L.y)
  // out[i] = y
  get(P.ptrOut); get(L.i); ic(2); op(OP.i32Shl); op(OP.i32Add); get(L.y); op(OP.f32Store, 2, 0)
  // shift state: x2=x1; x1=x; y2=y1; y1=y
  get(L.x1); set(L.x2)
  get(L.x); set(L.x1)
  get(L.y1); set(L.y2)
  get(L.y); set(L.y1)
  // i++
  get(L.i); ic(1); op(OP.i32Add); set(L.i)
  op(OP.br, 0); op(OP.end); op(OP.end)
  // store state back
  get(P.ptrState); get(L.x1); op(OP.f32Store, 2, 0)
  get(P.ptrState); get(L.x2); op(OP.f32Store, 2, 4)
  get(P.ptrState); get(L.y1); op(OP.f32Store, 2, 8)
  get(P.ptrState); get(L.y2); op(OP.f32Store, 2, 12)
  op(OP.end)

  return { params: [I32, I32, F32, F32, F32, F32, F32, I32, I32], results: [], locals: [[1, I32], [6, F32]], body: B }
}

// ── blockPower(): sliding-window mean-square ─────────────────────────────────
function buildBlockPower() {
  const P = { ptrIn: 0, nIn: 1, frame: 2, hop: 3, ptrOut: 4 }
  const L = { nFrames: 5, f: 6, start: 7, k: 8, sum: 9, x: 10, meanSq: 11 }
  const { B, get, set, ic, fc, op } = emitter()

  get(P.nIn); get(P.frame); op(OP.i32GeS)
  op(OP.if, I32)
  get(P.nIn); get(P.frame); op(OP.i32Sub); get(P.hop); op(OP.i32DivS); ic(1); op(OP.i32Add)
  op(OP.else)
  ic(0)
  op(OP.end)
  set(L.nFrames)

  ic(0); set(L.f)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.f); get(L.nFrames); op(OP.i32GeS); op(OP.br_if, 1)
  get(L.f); get(P.hop); op(OP.i32Mul); set(L.start)
  fc(0); set(L.sum)
  ic(0); set(L.k)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.k); get(P.frame); op(OP.i32GeS); op(OP.br_if, 1)
  get(P.ptrIn); get(L.start); get(L.k); op(OP.i32Add); ic(2); op(OP.i32Shl); op(OP.i32Add); op(OP.f32Load, 2, 0); set(L.x)
  get(L.sum); get(L.x); get(L.x); op(OP.f32Mul); op(OP.f32Add); set(L.sum)
  get(L.k); ic(1); op(OP.i32Add); set(L.k)
  op(OP.br, 0); op(OP.end); op(OP.end)
  get(L.sum); get(P.frame); op(OP.f32ConvertI32S); op(OP.f32Div); set(L.meanSq)
  get(P.ptrOut); get(L.f); ic(2); op(OP.i32Shl); op(OP.i32Add); get(L.meanSq); op(OP.f32Store, 2, 0)
  get(L.f); ic(1); op(OP.i32Add); set(L.f)
  op(OP.br, 0); op(OP.end); op(OP.end)
  get(L.nFrames)
  op(OP.end)

  return { params: [I32, I32, I32, I32, I32], results: [I32], locals: [[4, I32], [3, F32]], body: B }
}

// ── peak(): max |sample| ─────────────────────────────────────────────────────
function buildPeak() {
  const P = { ptrIn: 0, nIn: 1 }
  const L = { i: 2, best: 3, x: 4 }
  const { B, get, set, ic, fc, op } = emitter()

  fc(0); set(L.best)
  ic(0); set(L.i)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.i); get(P.nIn); op(OP.i32GeS); op(OP.br_if, 1)
  get(P.ptrIn); get(L.i); ic(2); op(OP.i32Shl); op(OP.i32Add); op(OP.f32Load, 2, 0); op(OP.f32Abs); set(L.x)
  get(L.best); get(L.x); op(OP.f32Max); set(L.best)
  get(L.i); ic(1); op(OP.i32Add); set(L.i)
  op(OP.br, 0); op(OP.end); op(OP.end)
  get(L.best)
  op(OP.end)

  return { params: [I32, I32], results: [F32], locals: [[1, I32], [2, F32]], body: B }
}

// ── waveformPeaks(): per-bucket max |sample| ─────────────────────────────────
function buildWaveform() {
  const P = { ptrIn: 0, nIn: 1, buckets: 2, ptrOut: 3 }
  const L = { bsize: 4, b: 5, start: 6, k: 7, best: 8, x: 9 }
  const { B, get, set, ic, fc, op } = emitter()

  get(P.nIn); get(P.buckets); op(OP.i32DivS); set(L.bsize)
  ic(0); set(L.b)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.b); get(P.buckets); op(OP.i32GeS); op(OP.br_if, 1)
  get(L.b); get(L.bsize); op(OP.i32Mul); set(L.start)
  fc(0); set(L.best)
  ic(0); set(L.k)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.k); get(L.bsize); op(OP.i32GeS); op(OP.br_if, 1)
  get(P.ptrIn); get(L.start); get(L.k); op(OP.i32Add); ic(2); op(OP.i32Shl); op(OP.i32Add); op(OP.f32Load, 2, 0); op(OP.f32Abs); set(L.x)
  get(L.best); get(L.x); op(OP.f32Max); set(L.best)
  get(L.k); ic(1); op(OP.i32Add); set(L.k)
  op(OP.br, 0); op(OP.end); op(OP.end)
  get(P.ptrOut); get(L.b); ic(2); op(OP.i32Shl); op(OP.i32Add); get(L.best); op(OP.f32Store, 2, 0)
  get(L.b); ic(1); op(OP.i32Add); set(L.b)
  op(OP.br, 0); op(OP.end); op(OP.end)
  op(OP.end)

  return { params: [I32, I32, I32, I32], results: [], locals: [[4, I32], [2, F32]], body: B }
}

// ── yencDecode(): yEnc binary decode (Usenet article bodies) ──────────────────
// in[] is the concatenated yEnc DATA bytes (caller strips =ybegin/=ypart/=yend
// control lines, CRLFs and NNTP dot-stuffing first). Per byte: `=` (0x3D) escapes
// the next byte as (next-64-42); otherwise the byte is (c-42); both mod 256 via the
// 8-bit store. Returns the number of decoded bytes written at ptrOut.
function buildYenc() {
  const P = { ptrIn: 0, nIn: 1, ptrOut: 2 }
  const L = { i: 3, j: 4, c: 5, d: 6 }
  const { B, get, set, ic, op } = emitter()

  ic(0); set(L.i)
  ic(0); set(L.j)
  op(OP.block, OP.EMPTY); op(OP.loop, OP.EMPTY)
  get(L.i); get(P.nIn); op(OP.i32GeS); op(OP.br_if, 1)
  // c = in[i]
  get(P.ptrIn); get(L.i); op(OP.i32Add); op(OP.i32Load8U, 0, 0); set(L.c)
  get(L.c); ic(0x3d); op(OP.i32Eq)
  op(OP.if, OP.EMPTY)
    // escape: consume next byte d, out[j] = d - 106  (= -64 -42)
    get(L.i); ic(1); op(OP.i32Add); set(L.i)
    get(P.ptrIn); get(L.i); op(OP.i32Add); op(OP.i32Load8U, 0, 0); set(L.d)
    get(P.ptrOut); get(L.j); op(OP.i32Add); get(L.d); ic(106); op(OP.i32Sub); op(OP.i32Store8, 0, 0)
  op(OP.else)
    // out[j] = c - 42
    get(P.ptrOut); get(L.j); op(OP.i32Add); get(L.c); ic(42); op(OP.i32Sub); op(OP.i32Store8, 0, 0)
  op(OP.end)
  get(L.j); ic(1); op(OP.i32Add); set(L.j)
  get(L.i); ic(1); op(OP.i32Add); set(L.i)
  op(OP.br, 0); op(OP.end); op(OP.end)
  get(L.j)
  op(OP.end)

  return { params: [I32, I32, I32], results: [I32], locals: [[4, I32]], body: B }
}

// ── assemble module ──────────────────────────────────────────────────────────
function assemble(funcs) {
  const typeSec = section(0x01, vec(funcs.map((f) => [0x60, ...vec(f.params.map((t) => [t])), ...vec((f.results || []).map((t) => [t]))])))
  const importSec = section(0x02, vec([[...str('env'), ...str('mem'), 0x02, 0x00, ...uleb(0)]]))
  const funcSec = section(0x03, vec(funcs.map((_, i) => [i])))
  const exportSec = section(0x07, vec(funcs.map((f, i) => [...str(f.name), 0x00, i])))
  const codeSec = section(0x0a, vec(funcs.map((f) => {
    const localDecls = vec(f.locals.map(([count, t]) => [...uleb(count), t]))
    const entry = [...localDecls, ...f.body]
    return [...uleb(entry.length), ...entry]
  })))
  return Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...typeSec, ...importSec, ...funcSec, ...exportSec, ...codeSec])
}

const funcs = [
  { name: 'biquad', ...buildBiquad() },
  { name: 'blockPower', ...buildBlockPower() },
  { name: 'peak', ...buildPeak() },
  { name: 'waveformPeaks', ...buildWaveform() },
  { name: 'yencDecode', ...buildYenc() },
]
const wasm = assemble(funcs)
if (!WebAssembly.validate(wasm)) throw new Error('module failed WebAssembly.validate()')

// ── JS reference twins (f32 throughout) ──────────────────────────────────────
const fr = Math.fround
function biquadRef(out, inp, n, c, state) {
  const b0 = fr(c[0]), b1 = fr(c[1]), b2 = fr(c[2]), a1 = fr(c[3]), a2 = fr(c[4])
  let x1 = state[0], x2 = state[1], y1 = state[2], y2 = state[3]
  for (let i = 0; i < n; i++) {
    const x = inp[i]
    let y = fr(b0 * x)
    y = fr(y + fr(b1 * x1))
    y = fr(y + fr(b2 * x2))
    y = fr(y - fr(a1 * y1))
    y = fr(y - fr(a2 * y2))
    out[i] = y
    x2 = x1; x1 = x; y2 = y1; y1 = y
  }
  state[0] = x1; state[1] = x2; state[2] = y1; state[3] = y2
}
function blockPowerRef(out, inp, n, frame, hop) {
  const nFrames = n >= frame ? Math.trunc((n - frame) / hop) + 1 : 0
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop
    let sum = 0
    for (let k = 0; k < frame; k++) { const x = inp[start + k]; sum = fr(sum + fr(x * x)) }
    out[f] = fr(sum / fr(frame))
  }
  return nFrames
}
function peakRef(inp, n) {
  let best = 0
  for (let i = 0; i < n; i++) { const x = Math.abs(inp[i]); if (x > best) best = x }
  return fr(best)
}
function waveformRef(out, inp, n, buckets) {
  const bsize = Math.trunc(n / buckets)
  for (let b = 0; b < buckets; b++) {
    const start = b * bsize
    let best = 0
    for (let k = 0; k < bsize; k++) { const x = Math.abs(inp[start + k]); if (x > best) best = x }
    out[b] = fr(best)
  }
}
// yEnc decode reference (u8). Mirrors the wasm kernel exactly.
function yencRef(out, inp, n) {
  let j = 0
  for (let i = 0; i < n; i++) {
    const c = inp[i]
    if (c === 0x3d) { i++; out[j++] = (inp[i] - 106) & 0xff }
    else out[j++] = (c - 42) & 0xff
  }
  return j
}
// A minimal yEnc *encoder* (test fixtures only): the four critical bytes
// (NUL, LF, CR, '=') must be escaped; everything else is (b+42) mod 256.
function yencEncode(bytes) {
  const out = []
  for (const b of bytes) {
    const e = (b + 42) & 0xff
    if (e === 0x00 || e === 0x0a || e === 0x0d || e === 0x3d) out.push(0x3d, (e + 64) & 0xff)
    else out.push(e)
  }
  return Uint8Array.from(out)
}

// ── instantiate + self-verify ────────────────────────────────────────────────
const PAGE = 65536
function instantiate(byteLen) {
  const mem = new WebAssembly.Memory({ initial: Math.ceil(byteLen / PAGE) + 1 })
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasm), { env: { mem } })
  return { mem, inst }
}
function rng(seed) {
  let s = seed | 0
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 }
}
function randSignal(n, seed) {
  const next = rng(seed); const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = fr(next() * 2 - 1)
  return a
}

function runBiquad(inp, c) {
  const n = inp.length
  const { mem, inst } = instantiate((n * 2 + 4) * 4)
  new Float32Array(mem.buffer, 0, n).set(inp)
  const statePtr = n * 4
  const outPtr = n * 4 + 16
  new Float32Array(mem.buffer, statePtr, 4).fill(0)
  inst.exports.biquad(0, n, c[0], c[1], c[2], c[3], c[4], statePtr, outPtr)
  return new Float32Array(mem.buffer, outPtr, n).slice()
}
function runBlockPower(inp, frame, hop) {
  const n = inp.length
  const maxF = n >= frame ? Math.trunc((n - frame) / hop) + 1 : 0
  const { mem, inst } = instantiate((n + Math.max(1, maxF)) * 4)
  new Float32Array(mem.buffer, 0, n).set(inp)
  const m = inst.exports.blockPower(0, n, frame, hop, n * 4)
  return new Float32Array(mem.buffer, n * 4, m).slice()
}
function runPeak(inp) {
  const n = inp.length
  const { mem, inst } = instantiate(n * 4)
  new Float32Array(mem.buffer, 0, n).set(inp)
  return inst.exports.peak(0, n)
}
function runWaveform(inp, buckets) {
  const n = inp.length
  const { mem, inst } = instantiate((n + buckets) * 4)
  new Float32Array(mem.buffer, 0, n).set(inp)
  inst.exports.waveformPeaks(0, n, buckets, n * 4)
  return new Float32Array(mem.buffer, n * 4, buckets).slice()
}
function runYenc(enc) {
  const n = enc.length
  const { mem, inst } = instantiate(n * 2 + 16) // out (<= n) lives at offset n
  new Uint8Array(mem.buffer, 0, n).set(enc)
  const m = inst.exports.yencDecode(0, n, n)
  return new Uint8Array(mem.buffer, n, m).slice()
}

// K-weighting coefficients @48k (ITU-R BS.1770) — also the real-world use.
const K1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]
const K2 = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621]

// biquad: K-weighting stages + a random stable-ish filter, across sizes
for (const [n, seed] of [[20000, 7], [48000, 99], [1234, 5]]) {
  const inp = randSignal(n, seed)
  for (const c of [K1, K2, [0.5, 0.2, -0.1, -0.3, 0.15]]) {
    const got = runBiquad(inp, c)
    const exp = new Float32Array(n)
    biquadRef(exp, inp, n, c, [0, 0, 0, 0])
    for (let i = 0; i < n; i++) if (got[i] !== exp[i]) throw new Error(`biquad mismatch @${i}: wasm=${got[i]} js=${exp[i]}`)
  }
}
// blockPower
for (const [n, frame, hop, seed] of [[48000, 19200, 4800, 11], [9600, 4800, 4800, 3], [1000, 400, 160, 8]]) {
  const inp = randSignal(n, seed)
  const got = runBlockPower(inp, frame, hop)
  const nF = n >= frame ? Math.trunc((n - frame) / hop) + 1 : 0
  const exp = new Float32Array(nF)
  blockPowerRef(exp, inp, n, frame, hop)
  if (got.length !== nF) throw new Error(`blockPower count: wasm=${got.length} js=${nF}`)
  for (let i = 0; i < nF; i++) if (got[i] !== exp[i]) throw new Error(`blockPower mismatch @${i}: wasm=${got[i]} js=${exp[i]}`)
}
// a constant-amplitude block has mean-square == amp²
{
  const inp = new Float32Array(800).fill(0.5)
  const got = runBlockPower(inp, 400, 400)
  for (const v of got) if (Math.abs(v - 0.25) > 1e-6) throw new Error(`const 0.5 → meanSq 0.25, got ${v}`)
}
// peak
for (const [n, seed] of [[5000, 1], [48000, 2]]) {
  const inp = randSignal(n, seed)
  const got = runPeak(inp), exp = peakRef(inp, n)
  if (got !== exp) throw new Error(`peak mismatch: wasm=${got} js=${exp}`)
}
{
  const inp = Float32Array.from([0.1, -0.9, 0.3, 0.85, -0.2])
  if (Math.abs(runPeak(inp) - 0.9) > 1e-7) throw new Error('peak should be 0.9')
}
// waveformPeaks
for (const [n, buckets, seed] of [[48000, 400, 4], [10000, 256, 6], [5000, 100, 9]]) {
  const inp = randSignal(n, seed)
  const got = runWaveform(inp, buckets)
  const exp = new Float32Array(buckets)
  waveformRef(exp, inp, n, buckets)
  for (let i = 0; i < buckets; i++) if (got[i] !== exp[i]) throw new Error(`waveform mismatch @${i}: wasm=${got[i]} js=${exp[i]}`)
}
// yencDecode — round-trip every random buffer (forces escapes) + the JS twin, and
// confirm the full 0..255 byte alphabet survives an encode→decode cycle.
for (const [n, seed] of [[256, 1], [4096, 2], [65537, 3]]) {
  const next = rng(seed)
  const orig = new Uint8Array(n)
  for (let i = 0; i < n; i++) orig[i] = Math.floor(next() * 256) & 0xff
  const enc = yencEncode(orig)
  const got = runYenc(enc)
  if (got.length !== n) throw new Error(`yenc length: wasm=${got.length} orig=${n}`)
  const twin = new Uint8Array(enc.length)
  const tn = yencRef(twin, enc, enc.length)
  for (let i = 0; i < n; i++) {
    if (got[i] !== orig[i]) throw new Error(`yenc mismatch @${i}: wasm=${got[i]} orig=${orig[i]}`)
    if (twin[i] !== orig[i]) throw new Error(`yenc twin mismatch @${i}: js=${twin[i]} orig=${orig[i]}`)
  }
  if (tn !== n) throw new Error(`yenc twin length: js=${tn} orig=${n}`)
}
{
  const all = new Uint8Array(256)
  for (let i = 0; i < 256; i++) all[i] = i
  const got = runYenc(yencEncode(all))
  for (let i = 0; i < 256; i++) if (got[i] !== i) throw new Error(`yenc alphabet @${i}: got ${got[i]}`)
}

// informational perf: K-weight 5 min of 48k mono (the per-track hot path)
{
  const n = 48000 * 60 * 5
  const inp = randSignal(n, 24680)
  let a = performance.now(); runBiquad(inp, K1); const tw = performance.now() - a
  const exp = new Float32Array(n)
  a = performance.now(); biquadRef(exp, inp, n, K1, [0, 0, 0, 0]); const tj = performance.now() - a
  console.log(`  biquad 5min 48k (${n.toLocaleString()} samples):  wasm ${tw.toFixed(0)}ms   js ${tj.toFixed(0)}ms   (${(tj / tw).toFixed(2)}×)`)
}
// informational perf: yEnc-decode a 32 MB article body (a real album part)
{
  const next = rng(1357)
  const raw = new Uint8Array(32 * 1024 * 1024)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(next() * 256) & 0xff
  const enc = yencEncode(raw)
  let a = performance.now(); runYenc(enc); const tw = performance.now() - a
  const twin = new Uint8Array(enc.length)
  a = performance.now(); yencRef(twin, enc, enc.length); const tj = performance.now() - a
  console.log(`  yencDecode 32MB body (${enc.length.toLocaleString()} enc bytes):  wasm ${tw.toFixed(0)}ms   js ${tj.toFixed(0)}ms   (${(tj / tw).toFixed(2)}×)`)
}

// ── write outputs ─────────────────────────────────────────────────────────────
mkdirSync(dirname(OUT_WASM), { recursive: true })
mkdirSync(dirname(OUT_BYTES), { recursive: true })
writeFileSync(OUT_WASM, wasm)

const b64 = Buffer.from(wasm).toString('base64')
writeFileSync(OUT_BYTES,
  `// AUTO-GENERATED by scripts/gen-wasm-kernels.mjs — do not edit.\n` +
  `// Timbre's loudness/DSP + Usenet kernel (biquad + blockPower + peak +\n` +
  `// waveformPeaks + yencDecode), base64-embedded so it loads without a filesystem lookup.\n` +
  `export const KERNEL_BYTES: Uint8Array = Uint8Array.from(atob(\n` +
  `\t'${b64}'\n` +
  `), (c) => c.charCodeAt(0));\n`)

const hash = createHash('sha1').update(wasm).digest('hex').slice(0, 10)
writeFileSync(OUT_VERSION,
  `// AUTO-GENERATED by scripts/gen-wasm-kernels.mjs — do not edit.\n` +
  `export const KERNEL_VERSION = '${hash}';\n`)

const rel = (p) => p.replace(ROOT + '/', '')
console.log('✓ verified biquad + blockPower + peak + waveformPeaks + yencDecode match their JS twins bit-for-bit')
console.log(`✓ wrote ${rel(OUT_WASM)} (${wasm.length} bytes, 5 exports)`)
console.log(`✓ wrote ${rel(OUT_BYTES)} + ${rel(OUT_VERSION)} (v=${hash})`)
