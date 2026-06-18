// "Now playing" ping — fired by the player when a local track starts. Best-effort
// and fire-and-forget: if Last.fm isn't connected or is unreachable, it just
// returns ok:false and playback carries on untouched.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { trackForScrobble } from '$lib/server/repo';
import { updateNowPlaying } from '$lib/server/lastfm';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { trackId?: number };
	const id = Number(body.trackId);
	if (!Number.isFinite(id)) return json({ ok: false });
	const meta = trackForScrobble(id);
	if (!meta) return json({ ok: false });
	const ok = await updateNowPlaying(meta);
	return json({ ok });
};
