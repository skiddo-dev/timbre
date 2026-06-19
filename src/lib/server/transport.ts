// The unified transport — one coordinator over the one shared queue, with a
// selectable OUTPUT TARGET: 'browser' (Web Audio on the client, the default),
// 'snapcast' (a zone, via the FIFO feeder) or 'airplay' (a device, via pyatv).
//
// The browser stays the queue's source of truth; when you switch to a non-browser
// output it hands the resolved queue (Playable[]) + current index/position here.
// We resolve each Playable to an ffmpeg input ourselves — re-deriving Subsonic's
// authed URL from the remote id, never trusting a client-supplied stream URL — so
// local, Subsonic and radio sources all cast through the same pipe. The server
// can't read hardware position, so cast/airplay position is ESTIMATED from the
// item's start time + elapsed (see streamer.getCastStatus / airPos).
import { getPlayerState, setPlayerState } from './playback';
import { getTrack, getTrackPath } from './repo';
import { streamSourceUrl } from './subsonic';
import {
	startCast,
	stopCast,
	skipCast,
	seekCast,
	setCastIndex,
	getCastStatus,
	castReady,
	type CastItem
} from './streamer';
import { castToDevice, stopAirplay, airplayEnabled, airplayStatus } from './airplay';
import { setGroupStream, snapcastConfigured } from './snapcast';
import type { OutputTarget, Playable, TransportStatus } from '$lib/types';

interface THolder {
	items: CastItem[]; // the resolved cast queue (for airplay stepping + snapcast resume)
	index: number;
	paused: boolean;
	pausedMs: number; // position remembered across a cast pause
	airStartedAt: number; // ms epoch for the airplay position estimate
}
const g = globalThis as unknown as { __timbreTransport?: THolder };
function th(): THolder {
	if (!g.__timbreTransport) g.__timbreTransport = { items: [], index: 0, paused: false, pausedMs: 0, airStartedAt: 0 };
	return g.__timbreTransport;
}

const clampIndex = (i: number, len: number) => (len === 0 ? 0 : Math.max(0, Math.min(i, len - 1)));

/** Resolve a client Playable to a cast item (an ffmpeg input + display meta). */
function resolveItem(p: Playable): CastItem | null {
	let input: string | null = null;
	if (p.source === 'local' && p.trackId != null) input = getTrackPath(p.trackId);
	else if (p.source === 'subsonic' && p.remoteId) input = streamSourceUrl(p.remoteId);
	else if (p.source === 'radio' && p.url) input = p.url;
	if (!input) return null;
	return {
		input,
		trackId: p.trackId ?? null,
		title: p.title ?? '',
		artist: p.artist ?? '',
		durationMs: p.durationMs ?? 0
	};
}
const resolveItems = (ps: Playable[]): CastItem[] =>
	ps.map(resolveItem).filter((x): x is CastItem => !!x);

const airPos = () => {
	const h = th();
	return h.airStartedAt ? Date.now() - h.airStartedAt : 0;
};

function airCastCurrent(deviceId: string): boolean {
	const h = th();
	const item = h.items[h.index];
	if (!item) return false;
	const ok = castToDevice(deviceId, item.input);
	if (ok) h.airStartedAt = Date.now();
	return ok;
}

// ── switch output ──────────────────────────────────────────────────────────────
export function setOutput(
	target: OutputTarget,
	id: string | null,
	playables: Playable[] = [],
	index = 0,
	positionMs = 0
): TransportStatus {
	const h = th();
	// tear down whatever else might be playing, then start the chosen output
	stopCast();
	stopAirplay();
	h.paused = false;
	h.pausedMs = 0;
	h.airStartedAt = 0;

	if (target === 'snapcast') {
		h.items = resolveItems(playables);
		h.index = clampIndex(index, h.items.length);
		if (snapcastConfigured() && id) setGroupStream(id, 'Timbre').catch(() => {}); // route the zone to our stream
		startCast(h.items, h.index);
		if (positionMs > 0) seekCast(positionMs);
		setPlayerState({ output: 'snapcast', outputId: id });
	} else if (target === 'airplay') {
		h.items = resolveItems(playables);
		h.index = clampIndex(index, h.items.length);
		if (airplayEnabled() && id) airCastCurrent(id);
		setPlayerState({ output: 'airplay', outputId: id });
	} else {
		h.items = [];
		h.index = 0;
		setPlayerState({ output: 'browser', outputId: null });
	}
	return getTransport();
}

// ── transport commands routed to the active output ──────────────────────────────
export function transportCmd(
	action: string,
	extra: { ms?: number; index?: number } = {}
): TransportStatus {
	const st = getPlayerState();
	const h = th();

	if (st.output === 'snapcast') {
		switch (action) {
			case 'pause':
				h.pausedMs = getCastStatus().positionMs;
				h.paused = true;
				stopCast();
				break;
			case 'play':
				if (h.paused) {
					startCast(h.items, h.index);
					if (h.pausedMs > 0) seekCast(h.pausedMs);
					h.paused = false;
				}
				break;
			case 'next':
				h.index = skipCast(1).index;
				break;
			case 'prev':
				h.index = skipCast(-1).index;
				break;
			case 'seek':
				seekCast(extra.ms ?? 0);
				break;
			case 'index':
				h.index = setCastIndex(extra.index ?? 0).index;
				break;
		}
	} else if (st.output === 'airplay') {
		switch (action) {
			case 'pause':
				h.pausedMs = airPos();
				h.paused = true;
				stopAirplay();
				break;
			case 'play':
				if (st.outputId) {
					airCastCurrent(st.outputId);
					h.paused = false;
				}
				break;
			case 'next':
				if (h.index + 1 < h.items.length && st.outputId) {
					h.index++;
					airCastCurrent(st.outputId);
				}
				break;
			case 'prev':
				if (h.index > 0 && st.outputId) {
					h.index--;
					airCastCurrent(st.outputId);
				}
				break;
			case 'index':
				if (extra.index != null && extra.index >= 0 && extra.index < h.items.length && st.outputId) {
					h.index = extra.index;
					airCastCurrent(st.outputId);
				}
				break;
		}
	}
	return getTransport();
}

// ── status ───────────────────────────────────────────────────────────────────
export function getTransport(): TransportStatus {
	const st = getPlayerState();
	const h = th();

	if (st.output === 'snapcast') {
		const c = getCastStatus();
		return {
			output: 'snapcast',
			outputId: st.outputId,
			casting: c.casting,
			playing: c.casting && !h.paused,
			paused: h.paused,
			index: c.index,
			currentTrackId: c.currentTrackId,
			positionMs: h.paused ? h.pausedMs : c.positionMs,
			durationMs: c.durationMs,
			title: c.title,
			artist: c.artist,
			error: castReady() ? c.error : 'Snapcast output is not configured (SNAPCAST_HOST + SNAPCAST_FIFO)'
		};
	}
	if (st.output === 'airplay') {
		const a = airplayStatus();
		const item = h.items[h.index];
		return {
			output: 'airplay',
			outputId: st.outputId,
			casting: a.casting,
			playing: a.casting && !h.paused,
			paused: h.paused,
			index: h.index,
			currentTrackId: item?.trackId ?? null,
			positionMs: h.paused ? h.pausedMs : airPos(),
			durationMs: item?.durationMs ?? 0,
			title: item?.title ?? null,
			artist: item?.artist ?? null,
			error: a.enabled ? null : 'AirPlay is disabled (set AIRPLAY_ENABLED=1)'
		};
	}

	return {
		output: 'browser',
		outputId: null,
		casting: false,
		playing: false,
		paused: false,
		index: -1,
		currentTrackId: st.currentTrackId,
		positionMs: 0,
		durationMs: 0,
		title: null,
		artist: null,
		error: null
	};
}

// ── helper: cast local library track ids (used by the /zones page's cast button) ─
export function castLocalTrackIds(ids: number[], startIndex = 0): TransportStatus {
	const items: CastItem[] = [];
	for (const id of ids) {
		const path = getTrackPath(id);
		if (!path) continue;
		const t = getTrack(id);
		items.push({ input: path, trackId: id, title: t?.title ?? '', artist: t?.artist ?? '', durationMs: t?.durationMs ?? 0 });
	}
	const h = th();
	h.items = items;
	h.index = clampIndex(startIndex, items.length);
	startCast(items, h.index);
	setPlayerState({ output: 'snapcast', outputId: getPlayerState().outputId });
	return getTransport();
}
