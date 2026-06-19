// The Snapcast output stage: decode the cast queue item-by-item with ffmpeg and
// write raw PCM into the snapserver FIFO, which broadcasts it bit-perfect + in sync
// to every snapclient. snapserver paces consumption (realtime), so the FIFO's write
// backpressure paces ffmpeg — no manual clocking needed. Gapless = chain the next
// ffmpeg into the same FIFO when one ends.
//
// A cast item carries a resolved ffmpeg INPUT (a local file path OR a remote URL —
// ffmpeg reads both), so the unified transport can cast local, Subsonic and radio
// sources alike. The shared DSP profile is applied here too (ffmpeg -af / afir), so
// a zone hears the same EQ + room correction as the browser.
//
// Best-effort + heavily gated: needs snapserver (SNAPCAST_HOST), a FIFO
// (SNAPCAST_FIFO, e.g. /tmp/snapfifo) and ffmpeg. If any is missing this is a no-op
// and browser playback continues unaffected. Untestable without the daemons; the
// control plane (snapcast.ts) is what the verify harness covers.
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, createWriteStream, closeSync, type WriteStream } from 'node:fs';
import { env } from '$env/dynamic/private';
import { snapcastConfigured } from './snapcast';
import { getDspProfile, activeIrPath } from './dsp';
import { ffmpegDspArgs } from '$lib/dsp';

const FIFO = () => (env.SNAPCAST_FIFO || '').trim();
const FFMPEG = () => env.FFMPEG_BIN || 'ffmpeg';

export interface CastItem {
	input: string; // ffmpeg input: a local file path or a remote URL
	trackId: number | null;
	title: string;
	artist: string;
	durationMs: number;
}

interface CastState {
	casting: boolean;
	queue: CastItem[];
	index: number;
	currentTrackId: number | null;
	startedAt: number; // ms epoch the current item's ffmpeg began (for position estimate)
	error: string | null;
}

interface Holder {
	state: CastState;
	proc: ChildProcess | null;
	stream: WriteStream | null;
	fd: number | null;
}

const g = globalThis as unknown as { __timbreCast?: Holder };
function holder(): Holder {
	if (!g.__timbreCast) {
		g.__timbreCast = {
			state: { casting: false, queue: [], index: 0, currentTrackId: null, startedAt: 0, error: null },
			proc: null,
			stream: null,
			fd: null
		};
	}
	return g.__timbreCast;
}

export function castReady(): boolean {
	return snapcastConfigured() && FIFO().length > 0;
}

export function getCastStatus() {
	const h = holder();
	const cur = h.state.queue[h.state.index];
	const durationMs = cur?.durationMs ?? 0;
	let positionMs = 0;
	if (h.state.casting && h.state.startedAt) {
		positionMs = Date.now() - h.state.startedAt;
		if (durationMs > 0) positionMs = Math.min(positionMs, durationMs);
	}
	return {
		ready: castReady(),
		fifo: FIFO() || null,
		...h.state,
		queueLength: h.state.queue.length,
		positionMs,
		durationMs,
		title: cur?.title ?? null,
		artist: cur?.artist ?? null
	};
}

function openFifo(h: Holder): boolean {
	try {
		// O_RDWR so opening doesn't block when no reader is attached yet (Linux/macOS).
		h.fd = openSync(FIFO(), 'r+');
		h.stream = createWriteStream('', { fd: h.fd });
		h.stream.on('error', () => {}); // EPIPE when snapserver restarts — tolerate
		return true;
	} catch (e) {
		h.state.error = e instanceof Error ? e.message : String(e);
		return false;
	}
}

function teardown(h: Holder) {
	if (h.proc) {
		h.proc.removeAllListeners();
		try {
			h.proc.kill('SIGKILL');
		} catch {
			/* already gone */
		}
		h.proc = null;
	}
	if (h.stream) {
		try {
			h.stream.destroy();
		} catch {
			/* noop */
		}
		h.stream = null;
	}
	if (h.fd != null) {
		try {
			closeSync(h.fd);
		} catch {
			/* noop */
		}
		h.fd = null;
	}
}

function playCurrent(h: Holder, seekMs = 0) {
	const item = h.state.queue[h.state.index];
	if (item == null) {
		stopCast();
		return;
	}
	if (!item.input) {
		h.state.index++;
		playCurrent(h);
		return;
	}
	h.state.currentTrackId = item.trackId;
	// Apply the shared DSP profile so the zone hears the same EQ + room correction.
	const { extraInputs, filterArgs } = ffmpegDspArgs(getDspProfile(), activeIrPath());
	const seek = seekMs > 0 ? ['-ss', (seekMs / 1000).toFixed(3)] : [];
	const args = [
		'-v', 'quiet',
		...seek,
		'-i', item.input,
		...extraInputs,
		...filterArgs,
		'-f', 's16le', '-ar', '48000', '-ac', '2', '-'
	];
	let proc: ChildProcess;
	try {
		proc = spawn(FFMPEG(), args, { stdio: ['ignore', 'pipe', 'ignore'] });
	} catch (e) {
		h.state.error = e instanceof Error ? e.message : String(e);
		stopCast();
		return;
	}
	h.proc = proc;
	h.state.startedAt = Date.now() - seekMs;
	if (h.stream && proc.stdout) proc.stdout.pipe(h.stream, { end: false });
	proc.on('error', (e) => {
		h.state.error = e.message;
		stopCast();
	});
	proc.on('close', () => {
		if (h.proc !== proc || !h.state.casting) return; // superseded by stop/next
		h.state.index++;
		if (h.state.index < h.state.queue.length) playCurrent(h);
		else stopCast();
	});
}

export function startCast(items: CastItem[], startIndex = 0): ReturnType<typeof getCastStatus> {
	const h = holder();
	if (!castReady()) {
		h.state.error = 'Snapcast/FIFO not configured';
		return getCastStatus();
	}
	teardown(h);
	const queue = items.filter((it) => it && it.input);
	h.state = {
		casting: true,
		queue,
		index: Math.max(0, Math.min(startIndex, queue.length - 1)),
		currentTrackId: null,
		startedAt: 0,
		error: null
	};
	if (queue.length === 0) {
		h.state.casting = false;
		return getCastStatus();
	}
	if (!openFifo(h)) {
		h.state.casting = false;
		return getCastStatus();
	}
	playCurrent(h);
	return getCastStatus();
}

export function stopCast(): ReturnType<typeof getCastStatus> {
	const h = holder();
	h.state.casting = false;
	h.state.currentTrackId = null;
	h.state.startedAt = 0;
	teardown(h);
	return getCastStatus();
}

function restartCurrent(h: Holder, seekMs = 0) {
	if (h.proc) {
		const p = h.proc;
		h.proc = null;
		p.removeAllListeners();
		try {
			p.kill('SIGKILL');
		} catch {
			/* noop */
		}
	}
	playCurrent(h, seekMs);
}

export function skipCast(delta: number): ReturnType<typeof getCastStatus> {
	const h = holder();
	if (!h.state.casting) return getCastStatus();
	const next = h.state.index + delta;
	if (next < 0 || next >= h.state.queue.length) return getCastStatus();
	h.state.index = next;
	restartCurrent(h);
	return getCastStatus();
}

/** Seek within the current cast item by restarting ffmpeg at an offset (a live
 * re-encode has no random access). Position is then estimated from the new start. */
export function seekCast(ms: number): ReturnType<typeof getCastStatus> {
	const h = holder();
	if (!h.state.casting) return getCastStatus();
	restartCurrent(h, Math.max(0, ms));
	return getCastStatus();
}

export function setCastIndex(index: number): ReturnType<typeof getCastStatus> {
	const h = holder();
	if (!h.state.casting) return getCastStatus();
	if (index < 0 || index >= h.state.queue.length) return getCastStatus();
	h.state.index = index;
	restartCurrent(h);
	return getCastStatus();
}
