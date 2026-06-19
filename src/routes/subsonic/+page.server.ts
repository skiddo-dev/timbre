import type { PageServerLoad } from './$types';
import { subsonicStatus, subsonicConfigured, browseAlbums } from '$lib/server/subsonic';
import type { SubsonicAlbum } from '$lib/types';

export const load: PageServerLoad = async () => {
	const status = subsonicStatus();
	let albums: SubsonicAlbum[] = [];
	if (subsonicConfigured()) {
		try {
			albums = await browseAlbums('newest', 24);
		} catch {
			/* unreachable server — the page renders an error/empty state */
		}
	}
	return { status, albums };
};
