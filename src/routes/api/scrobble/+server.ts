// Scrobble submission + history. POST {trackId, startedAt} records a finished
// play and tries to flush the queue; POST {flush:true} just retries the queue;
// GET returns recent scrobbles + connection status for the settings panel.
//
// Eligibility (≥30s long, played past 50% or 4 min) is decided by the player —
// this endpoint trusts that and snapshots the track's metadata into the queue,
// which is what lets a scrobble survive the track later being deleted.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trackForScrobble } from '$lib/server/repo';
import { enqueueScrobble, flushScrobbles, recentScrobbles, lastfmStatus } from '$lib/server/lastfm';

export const GET: RequestHandler = () =>
	json({ status: lastfmStatus(), scrobbles: recentScrobbles() });

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		trackId?: number;
		startedAt?: number;
		flush?: boolean;
		artist?: string;
		title?: string;
		album?: string;
	};

	// Retry-only: drain whatever is already queued.
	if (body.flush && body.trackId == null && !body.title) {
		const flush = await flushScrobbles();
		return json({ flush, status: lastfmStatus() });
	}

	// A remote/stream track (Subsonic, radio) has no local id — scrobble by metadata.
	// Otherwise snapshot the local track's metadata so the scrobble survives deletion.
	let meta: { trackId: number | null; artist: string; title: string; album: string | null } | null = body.title
		? { trackId: null, artist: (body.artist ?? '').trim(), title: body.title.trim(), album: (body.album ?? '').trim() || null }
		: null;
	if (!meta) {
		const id = Number(body.trackId);
		if (!Number.isFinite(id)) throw error(400, 'Missing trackId.');
		meta = trackForScrobble(id);
		if (!meta) throw error(404, 'Unknown track.');
	}
	if (!meta.artist || !meta.title) {
		// Nothing to scrobble against — skip rather than queue a row Last.fm rejects.
		return json({ ok: true, skipped: 'missing artist/title' });
	}

	// Trust the player's start time when sane; otherwise infer from now − duration.
	const now = Math.floor(Date.now() / 1000);
	const started = Number(body.startedAt);
	const playedAt =
		Number.isFinite(started) && started > 0 && started <= now ? Math.floor(started) : now;

	enqueueScrobble(meta, playedAt);
	const flush = await flushScrobbles();
	return json({ ok: true, flush, status: lastfmStatus() });
};
