// Auth-proxy for Subsonic cover art (getCoverArt). Same posture as the stream
// proxy: rebuild the salted-auth URL server-side, relay the image bytes, cache.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { subsonicConfigured, coverSourceUrl } from '$lib/server/subsonic';

export const GET: RequestHandler = async ({ params, url, request }) => {
	if (!subsonicConfigured()) throw error(404, 'Subsonic is not configured');
	const coverId = params.id;
	if (!coverId) throw error(400, 'missing id');
	const size = Math.min(1200, Math.max(32, Number(url.searchParams.get('size')) || 300));

	const upstream = await fetch(coverSourceUrl(coverId, size), { signal: request.signal }).catch(() => null);
	if (!upstream || !upstream.ok || !upstream.body) throw error(502, 'upstream cover art failed');

	return new Response(upstream.body, {
		status: 200,
		headers: {
			'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
			'Cache-Control': 'private, max-age=86400'
		}
	});
};
