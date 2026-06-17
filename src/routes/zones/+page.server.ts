import type { PageServerLoad } from './$types';
import { getZones } from '$lib/server/snapcast';

export const load: PageServerLoad = async () => ({ zones: await getZones() });
