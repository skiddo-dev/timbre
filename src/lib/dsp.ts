// Shared DSP profile — a parametric EQ + room-correction definition applied in
// TWO places from one source of truth, so every output sounds the same:
//   • the browser, via a chain of Web Audio BiquadFilterNodes + a ConvolverNode
//     (src/lib/audio/player.svelte.ts);
//   • the cast/transcode outputs, via ffmpeg's filter graph (streamer.ts +
//     /api/stream/[trackId]) — see ffmpegDspArgs().
// The profile lives in the `settings` table (JSON, key `dsp_profile`).
//
// Pure + isomorphic (no DOM, no node deps) so both sides import it. Bit-perfect
// output bypasses all of this by design — bit-perfect means untouched samples.
//
// EqBandType is deliberately the exact set of Web Audio BiquadFilterType values, so
// the browser maps a band to a node 1:1 (gain is ignored by the filter for the
// pass/notch types, exactly as in Web Audio).

export type EqBandType = 'peaking' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass' | 'notch';

export interface EqBand {
	id: string;
	type: EqBandType;
	freq: number; // Hz
	gain: number; // dB (used by peaking/lowshelf/highshelf)
	q: number; // quality / width
	enabled: boolean;
}

export interface DspProfile {
	enabled: boolean;
	preampDb: number; // overall pre-gain (headroom; usually ≤ 0 when boosting bands)
	bands: EqBand[];
	room: { enabled: boolean; irName: string | null }; // convolution impulse-response file
}

export const MAX_BANDS = 12;
export const FREQ_MIN = 20;
export const FREQ_MAX = 22_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
let seq = 0;
export const bandId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function defaultProfile(): DspProfile {
	return { enabled: false, preampDb: 0, bands: [], room: { enabled: false, irName: null } };
}

export function makeBand(partial: Partial<EqBand> = {}): EqBand {
	return {
		id: partial.id ?? bandId(),
		type: partial.type ?? 'peaking',
		freq: clamp(partial.freq ?? 1000, FREQ_MIN, FREQ_MAX),
		gain: clamp(partial.gain ?? 0, -24, 24),
		q: clamp(partial.q ?? 1, 0.1, 18),
		enabled: partial.enabled ?? true
	};
}

/** Validate + clamp an untrusted profile (from the API body or stored JSON). */
export function normalizeProfile(input: unknown): DspProfile {
	const o = (input ?? {}) as Partial<DspProfile> & { bands?: unknown[]; room?: { enabled?: unknown; irName?: unknown } };
	const bands = Array.isArray(o.bands) ? o.bands.slice(0, MAX_BANDS).map((b) => makeBand(b as Partial<EqBand>)) : [];
	return {
		enabled: !!o.enabled,
		preampDb: clamp(Number(o.preampDb ?? 0), -24, 24),
		bands,
		room: {
			enabled: !!o.room?.enabled,
			irName: typeof o.room?.irName === 'string' && o.room.irName ? sanitizeIrName(o.room.irName) : null
		}
	};
}

/** IR filenames are user-supplied → keep them to a safe basename (no path tricks). */
export function sanitizeIrName(name: string): string {
	return name.replace(/[^\w.-]/g, '_').replace(/^\.+/, '').slice(0, 80);
}

// ── built-in presets ──────────────────────────────────────────────────────────
export interface Preset {
	name: string;
	preampDb: number;
	bands: Omit<EqBand, 'id'>[];
}
const b = (type: EqBandType, freq: number, gain: number, q = 1): Omit<EqBand, 'id'> => ({ type, freq, gain, q, enabled: true });

export const PRESETS: Preset[] = [
	{ name: 'Flat', preampDb: 0, bands: [] },
	{ name: 'Bass boost', preampDb: -3, bands: [b('lowshelf', 90, 6, 0.7)] },
	{ name: 'Loudness', preampDb: -4, bands: [b('lowshelf', 60, 5, 0.7), b('highshelf', 12_000, 4, 0.7)] },
	{ name: 'Vocal', preampDb: -1, bands: [b('peaking', 300, -2, 1), b('peaking', 2500, 3, 1.2)] },
	{ name: 'Late night', preampDb: -2, bands: [b('lowshelf', 80, -5, 0.7), b('peaking', 2000, 2, 1.2), b('highshelf', 10_000, -3, 0.7)] }
];

export function presetProfile(name: string, base: DspProfile): DspProfile {
	const p = PRESETS.find((x) => x.name === name);
	if (!p) return base;
	return { ...base, preampDb: p.preampDb, bands: p.bands.map((x) => makeBand(x)) };
}

// ── REW / EqualizerAPO import ───────────────────────────────────────────────────
// Parse the de-facto room-correction export format (lines like
// `Filter 1: ON PK Fc 1000 Hz Gain -3.0 dB Q 1.41`). PK→peaking, LS/LSC→lowshelf,
// HS/HSC→highshelf, LP→lowpass, HP→highpass, NO→notch. Unknown/OFF lines skipped.
const APO_TYPE: Record<string, EqBandType> = {
	PK: 'peaking', PEQ: 'peaking', Modal: 'peaking',
	LS: 'lowshelf', LSC: 'lowshelf', LSQ: 'lowshelf',
	HS: 'highshelf', HSC: 'highshelf', HSQ: 'highshelf',
	LP: 'lowpass', LPQ: 'lowpass', HP: 'highpass', HPQ: 'highpass', NO: 'notch'
};
export function parseEqualizerApo(text: string): { bands: EqBand[]; preampDb: number } {
	const bands: EqBand[] = [];
	let preampDb = 0;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		const pre = /^Preamp:\s*(-?\d+(?:\.\d+)?)\s*dB/i.exec(line);
		if (pre) {
			preampDb = clamp(Number(pre[1]), -24, 24);
			continue;
		}
		const f = /^Filter\s*\d*:\s*(ON|OFF)\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz(?:\s+Gain\s+(-?[\d.]+)\s*dB)?(?:\s+Q\s+([\d.]+))?/i.exec(line);
		if (!f) continue;
		const type = APO_TYPE[f[2].toUpperCase()] ?? APO_TYPE[f[2]];
		if (!type) continue;
		if (bands.length >= MAX_BANDS) break;
		bands.push(
			makeBand({
				type,
				freq: Number(f[3]),
				gain: f[4] ? Number(f[4]) : 0,
				q: f[5] ? Number(f[5]) : 1,
				enabled: f[1].toUpperCase() === 'ON'
			})
		);
	}
	return { bands, preampDb };
}

// ── ffmpeg filter graph (server: cast feeder + transcode) ───────────────────────
const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** The per-band + preamp portion of an ffmpeg audio filter chain (no room IR). */
export function eqFilterChain(profile: DspProfile): string[] {
	const parts: string[] = [];
	if (profile.preampDb !== 0) parts.push(`volume=${num(profile.preampDb)}dB`);
	for (const band of profile.bands) {
		if (!band.enabled) continue;
		const f = num(clamp(band.freq, FREQ_MIN, FREQ_MAX));
		const g = num(band.gain);
		const q = num(clamp(band.q, 0.1, 18));
		switch (band.type) {
			case 'peaking':
				parts.push(`equalizer=f=${f}:t=q:w=${q}:g=${g}`);
				break;
			case 'lowshelf':
				parts.push(`bass=g=${g}:f=${f}:t=q:w=${q}`);
				break;
			case 'highshelf':
				parts.push(`treble=g=${g}:f=${f}:t=q:w=${q}`);
				break;
			case 'lowpass':
				parts.push(`lowpass=f=${f}:t=q:w=${q}`);
				break;
			case 'highpass':
				parts.push(`highpass=f=${f}:t=q:w=${q}`);
				break;
			case 'notch':
				parts.push(`bandreject=f=${f}:t=q:w=${q}`);
				break;
		}
	}
	return parts;
}

/** A single `-af` string for the EQ chain, or '' when there's nothing to apply. */
export function toFfmpegFilter(profile: DspProfile): string {
	if (!profile.enabled) return '';
	return eqFilterChain(profile).join(',');
}

/** Full ffmpeg arg fragment for a DSP profile, composed by the caller as:
 *   ffmpeg -v quiet -i <input> ...extraInputs ...filterArgs -f s16le …
 * Room correction adds the IR as a second input and convolves via `afir`; plain EQ
 * uses a simple `-af`. Returns empty arrays when DSP is off / nothing to do. */
export function ffmpegDspArgs(profile: DspProfile, irPath: string | null): { extraInputs: string[]; filterArgs: string[] } {
	if (!profile.enabled) return { extraInputs: [], filterArgs: [] };
	const chain = eqFilterChain(profile);
	const useRoom = profile.room.enabled && !!irPath;

	if (!useRoom) {
		return chain.length ? { extraInputs: [], filterArgs: ['-af', chain.join(',')] } : { extraInputs: [], filterArgs: [] };
	}
	// EQ (if any) on the main input, then convolve with the IR (input #1).
	const eq = chain.length ? `[0:a]${chain.join(',')}[eq];` : '';
	const src = chain.length ? '[eq]' : '[0:a]';
	const complex = `${eq}${src}[1:a]afir=dry=10:wet=10[out]`;
	return { extraInputs: ['-i', irPath as string], filterArgs: ['-filter_complex', complex, '-map', '[out]'] };
}
