// Auth-proxy for a Subsonic track. The browser plays Track.streamUrl =
// /api/subsonic/stream/<remoteId>; we rebuild the salted-auth upstream URL
// server-side (the password never reaches the client) and relay the bytes,
// passing Range through so the seek bar works. Mirrors the streaming contract
// of /api/stream/[trackId].
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { subsonicConfigured, streamSourceUrl } from '$lib/server/subsonic';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!subsonicConfigured()) throw error(404, 'Subsonic is not configured');
	const remoteId = params.id;
	if (!remoteId) throw error(400, 'missing id');

	const range = request.headers.get('range');
	const upstream = await fetch(streamSourceUrl(remoteId), {
		headers: range ? { Range: range } : {},
		signal: request.signal
	}).catch(() => null);

	if (!upstream || !upstream.ok || !upstream.body) {
		throw error(502, `upstream Subsonic stream failed${upstream ? ` (${upstream.status})` : ''}`);
	}

	// Relay the bits the player cares about for seeking + buffering.
	const headers = new Headers({
		'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
		'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
		'Cache-Control': 'private, max-age=3600'
	});
	for (const h of ['content-length', 'content-range']) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	// fetch() already hands back a web ReadableStream — relay it straight through.
	return new Response(upstream.body, { status: upstream.status, headers });
};
