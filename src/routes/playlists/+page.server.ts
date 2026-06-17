import type { PageServerLoad } from './$types';
import { listPlaylists } from '$lib/server/repo';

export const load: PageServerLoad = () => ({ playlists: listPlaylists() });
