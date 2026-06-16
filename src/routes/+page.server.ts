import type { PageServerLoad } from './$types';
import { recentlyAddedAlbums, recentlyPlayedTracks, libraryStats } from '$lib/server/repo';

export const load: PageServerLoad = () => ({
	albums: recentlyAddedAlbums(18),
	recent: recentlyPlayedTracks(8),
	stats: libraryStats()
});
