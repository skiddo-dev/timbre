import type { PageServerLoad } from './$types';
import { listArtists } from '$lib/server/repo';

export const load: PageServerLoad = () => ({ artists: listArtists() });
