// Server side of the shared DSP profile: persist it in the `settings` table and
// manage the room-correction impulse-response (IR) files on disk. The browser and
// the ffmpeg cast/transcode outputs both read the SAME profile (see $lib/dsp.ts).
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { getSetting, setSetting } from './settings';
import { defaultProfile, normalizeProfile, sanitizeIrName, type DspProfile } from '$lib/dsp';

const KEY = 'dsp_profile';

export function getDspProfile(): DspProfile {
	const raw = getSetting(KEY);
	if (!raw) return defaultProfile();
	try {
		return normalizeProfile(JSON.parse(raw));
	} catch {
		return defaultProfile();
	}
}

export function setDspProfile(input: unknown): DspProfile {
	const profile = normalizeProfile(input);
	setSetting(KEY, JSON.stringify(profile));
	return profile;
}

// ── impulse-response files ─────────────────────────────────────────────────────
function irDir(): string {
	const dir = (env.DSP_DIR || join(env.DATABASE_PATH ? dirname(env.DATABASE_PATH) : 'data', 'dsp')).trim();
	mkdirSync(dir, { recursive: true });
	return dir;
}
// tiny local dirname (avoid importing the whole path module surface twice)
function dirname(p: string): string {
	const i = p.replace(/\/+$/, '').lastIndexOf('/');
	return i <= 0 ? '.' : p.slice(0, i);
}

export function irPath(name: string | null | undefined): string | null {
	if (!name) return null;
	const safe = sanitizeIrName(name);
	if (!safe) return null;
	const p = join(irDir(), safe);
	return existsSync(p) ? p : null;
}

/** Path to the IR referenced by the active profile (null if none / missing). */
export function activeIrPath(): string | null {
	return irPath(getDspProfile().room.irName);
}

export function saveIr(name: string, bytes: Buffer | Uint8Array): string {
	const safe = sanitizeIrName(name) || 'room.wav';
	writeFileSync(join(irDir(), safe), bytes);
	return safe;
}

export function readIr(name: string): Buffer | null {
	const p = irPath(name);
	return p ? readFileSync(p) : null;
}

export function deleteIr(name: string): void {
	const p = irPath(name);
	if (p) rmSync(p, { force: true });
}

export function listIrs(): string[] {
	try {
		return readdirSync(irDir()).filter((f) => !f.startsWith('.'));
	} catch {
		return [];
	}
}
