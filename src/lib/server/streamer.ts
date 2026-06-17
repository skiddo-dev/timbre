// The Snapcast output stage: decode the cast queue track-by-track with ffmpeg and
// write raw PCM into the snapserver FIFO, which broadcasts it bit-perfect + in sync
// to every snapclient. snapserver paces consumption (realtime), so the FIFO's write
// backpressure paces ffmpeg — no manual clocking needed. Gapless = chain the next
// ffmpeg into the same FIFO when one ends.
//
// Best-effort + heavily gated: needs snapserver (SNAPCAST_HOST), a FIFO
// (SNAPCAST_FIFO, e.g. /tmp/snapfifo) and ffmpeg. If any is missing this is a no-op
// and browser playback continues unaffected. Untestable without the daemons; the
// control plane (snapcast.ts) is what the verify harness covers.
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, createWriteStream, closeSync, type WriteStream } from 'node:fs';
import { env } from '$env/dynamic/private';
import { getTrackPath } from './repo';
import { snapcastConfigured } from './snapcast';

const FIFO = () => (env.SNAPCAST_FIFO || '').trim();
const FFMPEG = () => env.FFMPEG_BIN || 'ffmpeg';

interface CastState {
	casting: boolean;
	queue: number[];
	index: number;
	currentTrackId: number | null;
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
			state: { casting: false, queue: [], index: 0, currentTrackId: null, error: null },
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
	return {
		ready: castReady(),
		fifo: FIFO() || null,
		...h.state,
		queueLength: h.state.queue.length
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

function playCurrent(h: Holder) {
	const id = h.state.queue[h.state.index];
	if (id == null) {
		stopCast();
		return;
	}
	const path = getTrackPath(id);
	if (!path) {
		h.state.index++;
		playCurrent(h);
		return;
	}
	h.state.currentTrackId = id;
	let proc: ChildProcess;
	try {
		proc = spawn(FFMPEG(), ['-v', 'quiet', '-i', path, '-f', 's16le', '-ar', '48000', '-ac', '2', '-'], {
			stdio: ['ignore', 'pipe', 'ignore']
		});
	} catch (e) {
		h.state.error = e instanceof Error ? e.message : String(e);
		stopCast();
		return;
	}
	h.proc = proc;
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

export function startCast(trackIds: number[], startIndex = 0): ReturnType<typeof getCastStatus> {
	const h = holder();
	if (!castReady()) {
		h.state.error = 'Snapcast/FIFO not configured';
		return getCastStatus();
	}
	teardown(h);
	h.state = {
		casting: true,
		queue: trackIds.filter((n) => Number.isFinite(n)),
		index: Math.max(0, Math.min(startIndex, trackIds.length - 1)),
		currentTrackId: null,
		error: null
	};
	if (h.state.queue.length === 0) {
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
	teardown(h);
	return getCastStatus();
}

export function skipCast(delta: number): ReturnType<typeof getCastStatus> {
	const h = holder();
	if (!h.state.casting) return getCastStatus();
	const next = h.state.index + delta;
	if (next < 0 || next >= h.state.queue.length) return getCastStatus();
	h.state.index = next;
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
	playCurrent(h);
	return getCastStatus();
}
