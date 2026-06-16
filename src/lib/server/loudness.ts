// Per-track loudness analysis for volume leveling + the seek-bar waveform.
//
// Pipeline: ffmpeg decodes the file to mono 48 kHz f32 PCM → the hand-authored
// WASM kernel does the per-sample hot loops (BS.1770 K-weighting biquads, block
// mean-square, sample peak, waveform buckets) → this file does the light R128
// gating + log math and stores the result. ffmpeg is OPTIONAL: if it isn't on
// PATH the scan simply skips loudness for that file (no hard dependency), exactly
// like Cadence shelling out to whisper-cli.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { biquad, blockPower, peak, waveformPeaks, type BiquadCoeffs } from '$lib/wasm/audio';
import type { ScanStatus } from '$lib/types';

const FFMPEG = () => env.FFMPEG_BIN || 'ffmpeg';
const TARGET_LUFS = -18; // leveling reference (ReplayGain/Roon convention)
const RATE = 48_000;
const FRAME = (RATE * 400) / 1000; // 400 ms block  = 19200
const HOP = (RATE * 100) / 1000; //   100 ms hop    = 4800
const WAVE_BUCKETS = 400;

// ITU-R BS.1770 "K-weighting" @48k: high-shelf then RLB high-pass.
const K1: BiquadCoeffs = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const K2: BiquadCoeffs = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];

export interface LoudnessResult {
	lufs: number;
	truePeakDb: number;
	gainDb: number;
	peaks: Uint8Array;
}

/** Decode a file to mono 48 kHz f32 PCM. WAV is parsed natively (no ffmpeg
 *  needed); everything else goes through ffmpeg. null if neither can read it. */
async function decodePcm(path: string): Promise<Float32Array | null> {
	const lower = path.toLowerCase();
	if (lower.endsWith('.wav') || lower.endsWith('.wave')) {
		const wav = decodeWavFile(path);
		if (wav) return resampleTo(wav.pcm, wav.rate, RATE);
	}
	return decodeViaFfmpeg(path);
}

/** Native WAV reader → mono f32 at the file's own sample rate (PCM 8/16/24/32 + float32). */
function decodeWavFile(path: string): { pcm: Float32Array; rate: number } | null {
	let buf: Buffer;
	try {
		buf = readFileSync(path);
	} catch {
		return null;
	}
	if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE')
		return null;
	let off = 12;
	let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
	let dataOff = -1;
	let dataLen = 0;
	while (off + 8 <= buf.length) {
		const id = buf.toString('latin1', off, off + 4);
		const size = buf.readUInt32LE(off + 4);
		const body = off + 8;
		if (id === 'fmt ') {
			fmt = {
				format: buf.readUInt16LE(body),
				channels: buf.readUInt16LE(body + 2),
				rate: buf.readUInt32LE(body + 4),
				bits: buf.readUInt16LE(body + 14)
			};
		} else if (id === 'data') {
			dataOff = body;
			dataLen = Math.min(size, buf.length - body);
		}
		off = body + size + (size % 2);
	}
	if (!fmt || dataOff < 0 || !fmt.channels || !fmt.bits) return null;
	const { channels, bits, format } = fmt;
	const bps = bits / 8;
	const frames = Math.floor(dataLen / (bps * channels));
	const out = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		let acc = 0;
		for (let c = 0; c < channels; c++) acc += readSample(buf, dataOff + (i * channels + c) * bps, bits, format);
		out[i] = acc / channels;
	}
	return { pcm: out, rate: fmt.rate };
}

function readSample(buf: Buffer, p: number, bits: number, format: number): number {
	if (format === 3 && bits === 32) return buf.readFloatLE(p);
	if (bits === 16) return buf.readInt16LE(p) / 32768;
	if (bits === 8) return (buf.readUInt8(p) - 128) / 128;
	if (bits === 24) {
		const v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
		return (v & 0x800000 ? v - 0x1000000 : v) / 8388608;
	}
	if (bits === 32) return buf.readInt32LE(p) / 2147483648;
	return 0;
}

/** Linear resample mono f32 to a target rate (good enough for loudness analysis). */
function resampleTo(pcm: Float32Array, from: number, to: number): Float32Array {
	if (from === to || pcm.length === 0) return pcm;
	const ratio = from / to;
	const n = Math.max(1, Math.floor(pcm.length / ratio));
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const pos = i * ratio;
		const i0 = Math.floor(pos);
		const frac = pos - i0;
		const a = pcm[i0];
		const b = pcm[Math.min(pcm.length - 1, i0 + 1)];
		out[i] = a + (b - a) * frac;
	}
	return out;
}

/** Decode any container to mono 48k f32 PCM via ffmpeg. null if ffmpeg missing/fails. */
function decodeViaFfmpeg(path: string): Promise<Float32Array | null> {
	return new Promise((resolve) => {
		let proc;
		try {
			proc = spawn(FFMPEG(), ['-v', 'quiet', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
				stdio: ['ignore', 'pipe', 'ignore']
			});
		} catch {
			resolve(null);
			return;
		}
		const chunks: Buffer[] = [];
		proc.stdout.on('data', (c: Buffer) => chunks.push(c));
		proc.on('error', () => resolve(null)); // ffmpeg not found
		proc.on('close', (code) => {
			if (code !== 0 && chunks.length === 0) return resolve(null);
			const buf = Buffer.concat(chunks);
			const n = Math.floor(buf.length / 4);
			if (n === 0) return resolve(null);
			const out = new Float32Array(n);
			for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
			resolve(out);
		});
	});
}

export async function analyzeLoudness(path: string): Promise<LoudnessResult | null> {
	const pcm = await decodePcm(path);
	if (!pcm || pcm.length === 0) return null;

	const samplePeak = peak(pcm);
	const truePeakDb = samplePeak > 0 ? 20 * Math.log10(samplePeak) : -120;

	// waveform overview → quantized 0..255 per bucket
	const wf = waveformPeaks(pcm, WAVE_BUCKETS);
	const peaks = new Uint8Array(wf.length);
	for (let i = 0; i < wf.length; i++) peaks[i] = Math.min(255, Math.round(Math.min(1, wf[i]) * 255));

	// K-weight, then per-block mean-square
	const kw = biquad(biquad(pcm, K1), K2);
	let blocks = blockPower(kw, FRAME, HOP);
	if (blocks.length === 0) {
		// track shorter than one block: treat the whole thing as a single block
		let sum = 0;
		for (let i = 0; i < kw.length; i++) sum += kw[i] * kw[i];
		blocks = Float32Array.of(kw.length ? sum / kw.length : 0);
	}

	const lufs = gatedLoudness(blocks);
	if (lufs == null) return { lufs: -70, truePeakDb, gainDb: 0, peaks };

	let gainDb = TARGET_LUFS - lufs;
	gainDb = Math.max(-24, Math.min(24, gainDb));
	return { lufs: round2(lufs), truePeakDb: round2(truePeakDb), gainDb: round2(gainDb), peaks };
}

/** EBU R128 two-stage gating over block mean-squares → integrated LUFS. */
function gatedLoudness(blocks: Float32Array): number | null {
	const loud = (z: number) => -0.691 + 10 * Math.log10(z);
	// absolute gate at -70 LUFS
	const abs: number[] = [];
	for (const z of blocks) if (z > 0 && loud(z) >= -70) abs.push(z);
	if (abs.length === 0) return null;
	// relative gate at -10 LU below the absolute-gated mean
	const meanAbs = abs.reduce((s, z) => s + z, 0) / abs.length;
	const relThresh = loud(meanAbs) - 10;
	const rel = abs.filter((z) => loud(z) >= relThresh);
	const keep = rel.length ? rel : abs;
	const meanZ = keep.reduce((s, z) => s + z, 0) / keep.length;
	return loud(meanZ);
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ── batch scan over un-analyzed tracks ───────────────────────────────────────
const g = globalThis as unknown as { __timbreLoud?: ScanStatus };
function status(): ScanStatus {
	if (!g.__timbreLoud) {
		g.__timbreLoud = {
			running: false, scanned: 0, added: 0, updated: 0, removed: 0, total: 0,
			startedAt: null, finishedAt: null, error: null, musicDir: ''
		};
	}
	return g.__timbreLoud;
}
export function getLoudnessStatus(): ScanStatus {
	return { ...status() };
}

const UPDATE = db.prepare(
	'UPDATE tracks SET loudness_lufs = ?, true_peak = ?, gain_db = ?, peaks_blob = ? WHERE id = ?'
);

/** Analyze tracks lacking loudness data. Returns when done (await for tests). */
export async function runLoudnessScan(limit = 0): Promise<ScanStatus> {
	const s = status();
	if (s.running) return getLoudnessStatus();
	Object.assign(s, {
		running: true, scanned: 0, added: 0, updated: 0, removed: 0, total: 0,
		startedAt: new Date().toISOString(), finishedAt: null, error: null
	});
	try {
		const sql = `SELECT id, path FROM tracks WHERE loudness_lufs IS NULL ORDER BY id${limit ? ' LIMIT ' + Math.floor(limit) : ''}`;
		const rows = db.prepare(sql).all() as { id: number; path: string }[];
		s.total = rows.length;
		for (const r of rows) {
			try {
				const res = await analyzeLoudness(r.path);
				if (res) {
					UPDATE.run(res.lufs, res.truePeakDb, res.gainDb, Buffer.from(res.peaks), r.id);
					s.updated++;
				}
			} catch {
				/* skip this track */
			}
			s.scanned++;
		}
	} catch (e) {
		s.error = e instanceof Error ? e.message : String(e);
	}
	s.running = false;
	s.finishedAt = new Date().toISOString();
	return getLoudnessStatus();
}

export function startLoudnessScan(limit = 0): ScanStatus {
	const s = status();
	if (s.running) return getLoudnessStatus();
	runLoudnessScan(limit).catch((e) => {
		s.error = e instanceof Error ? e.message : String(e);
		s.running = false;
	});
	return getLoudnessStatus();
}
