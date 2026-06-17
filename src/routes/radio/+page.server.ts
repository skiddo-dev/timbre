import type { PageServerLoad } from './$types';
import { listStations } from '$lib/server/radio';

export const load: PageServerLoad = () => ({ stations: listStations() });
