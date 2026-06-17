// AirPlay output — best-effort, via pyatv's CLI (atvremote / atvscript), the same
// "shell out to an optional tool, degrade if absent" pattern as the loudness scan
// and the Snapcast feeder. Off unless AIRPLAY_ENABLED=1 (scanning is slow), and a
// no-op if pyatv isn't installed. Casts a single track/URL to one device via
// `atvremote stream_file=…`. (Snapcast remains the primary multi-room path.)
import { spawn, type ChildProcess } from 'node:child_process';
import { env } from '$env/dynamic/private';
import { getTrackPath } from './repo';

const ATVREMOTE = () => env.AIRPLAY_BIN || 'atvremote';
const ATVSCRIPT = () => env.AIRPLAY_SCRIPT_BIN || 'atvscript';

export function airplayEnabled(): boolean {
	return env.AIRPLAY_ENABLED === '1' || env.AIRPLAY_ENABLED === 'true';
}

export interface AirDevice {
	id: string;
	name: string;
	address: string;
}

const g = globalThis as unknown as {
	__timbreAir?: { proc: ChildProcess | null; deviceId: string | null; source: string | null };
};
function holder() {
	if (!g.__timbreAir) g.__timbreAir = { proc: null, deviceId: null, source: null };
	return g.__timbreAir;
}

function run(bin: string, args: string[], timeoutMs = 12_000): Promise<string> {
	return new Promise((resolve) => {
		let out = '';
		let proc: ChildProcess;
		try {
			proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			return resolve('');
		}
		const timer = setTimeout(() => {
			try {
				proc.kill('SIGKILL');
			} catch {
				/* gone */
			}
		}, timeoutMs);
		proc.stdout?.on('data', (d) => (out += d.toString()));
		proc.on('error', () => {
			clearTimeout(timer);
			resolve('');
		});
		proc.on('close', () => {
			clearTimeout(timer);
			resolve(out);
		});
	});
}

/** Discover AirPlay receivers via `atvscript scan` (JSON). [] if pyatv is absent. */
export async function scanDevices(): Promise<AirDevice[]> {
	if (!airplayEnabled()) return [];
	const out = await run(ATVSCRIPT(), ['scan']);
	const devices: AirDevice[] = [];
	for (const line of out.split('\n')) {
		const t = line.trim();
		if (!t.startsWith('{')) continue;
		try {
			const j = JSON.parse(t) as Record<string, unknown>;
			const arr = (j.devices as Record<string, unknown>[]) ?? (j.identifier ? [j] : []);
			for (const d of arr) {
				const id = String(d.identifier ?? d.id ?? '');
				if (id) devices.push({ id, name: String(d.name ?? 'AirPlay'), address: String(d.address ?? '') });
			}
		} catch {
			/* skip non-JSON lines */
		}
	}
	return devices;
}

export function stopAirplay(): void {
	const h = holder();
	if (h.proc) {
		try {
			h.proc.kill('SIGKILL');
		} catch {
			/* gone */
		}
	}
	h.proc = null;
	h.deviceId = null;
	h.source = null;
}

/** Cast a local file or URL to a device. Returns false if disabled/unavailable. */
export function castToDevice(deviceId: string, source: string): boolean {
	if (!airplayEnabled() || !deviceId || !source) return false;
	stopAirplay();
	const h = holder();
	try {
		h.proc = spawn(ATVREMOTE(), ['--id', deviceId, `stream_file=${source}`], { stdio: 'ignore' });
		h.deviceId = deviceId;
		h.source = source;
		h.proc.on('exit', () => {
			if (holder().proc === h.proc) stopAirplay();
		});
		return true;
	} catch {
		stopAirplay();
		return false;
	}
}

export function castTrack(deviceId: string, trackId: number): boolean {
	const path = getTrackPath(trackId);
	if (!path) return false;
	return castToDevice(deviceId, path);
}

export function airplayStatus() {
	const h = holder();
	return { enabled: airplayEnabled(), casting: !!h.proc, deviceId: h.deviceId };
}
