import type { PageServerLoad } from './$types';
import { ftsAvailable } from '$lib/server/db';
import { getMusicDir } from '$lib/server/settings';
import { libraryStats } from '$lib/server/repo';
import { getScanStatus } from '$lib/server/scan';
import { usenetEngines } from '$lib/server/usenet/downloads';

export const load: PageServerLoad = () => ({
	musicDir: getMusicDir(),
	ftsAvailable,
	stats: libraryStats(),
	scan: getScanStatus(),
	usenet: usenetEngines()
});
