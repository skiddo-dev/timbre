import type { PageServerLoad } from './$types';
import { ftsAvailable } from '$lib/server/db';
import { getMusicDir } from '$lib/server/settings';
import { libraryStats } from '$lib/server/repo';
import { getScanStatus } from '$lib/server/scan';
import { lastfmStatus, recentScrobbles } from '$lib/server/lastfm';
import { appleMusicStatus } from '$lib/server/applemusicApi';
import { subsonicStatus } from '$lib/server/subsonic';
import { usenetEngines } from '$lib/server/usenet/downloads';

export const load: PageServerLoad = () => ({
	musicDir: getMusicDir(),
	ftsAvailable,
	stats: libraryStats(),
	scan: getScanStatus(),
	lastfm: lastfmStatus(),
	scrobbles: recentScrobbles(8),
	appleMusic: appleMusicStatus(),
	subsonic: subsonicStatus(),
	usenet: usenetEngines()
});
