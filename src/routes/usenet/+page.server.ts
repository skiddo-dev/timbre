import type { PageServerLoad } from './$types';
import { listIndexers } from '$lib/server/usenet/indexer';
import { listDownloads, usenetEngines } from '$lib/server/usenet/downloads';

export const load: PageServerLoad = () => ({
	indexers: listIndexers(),
	downloads: listDownloads(),
	engines: usenetEngines()
});
