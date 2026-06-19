// "Now playing" ping — fired by the player when a local track starts. Best-effort
// and fire-and-forget: if Last.fm isn't connected or is unreachable, it just
// returns ok:false and playback carries on untouched.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trackForScrobble } from '$lib/server/repo';
import { updateNowPlaying } from '$lib/server/lastfm';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		trackId?: number;
		artist?: string;
		title?: string;
		album?: string;
	};
	// Remote/stream tracks ping by metadata (no local id); local tracks by id.
	const meta = body.title
		? { trackId: null, artist: (body.artist ?? '').trim(), title: body.title.trim(), album: (body.album ?? '').trim() || null }
		: Number.isFinite(Number(body.trackId))
			? trackForScrobble(Number(body.trackId))
			: null;
	if (!meta || !meta.artist || !meta.title) return json({ ok: false });
	const ok = await updateNowPlaying(meta);
	return json({ ok });
};
