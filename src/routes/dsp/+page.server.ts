import type { PageServerLoad } from './$types';
import { getDspProfile, listIrs } from '$lib/server/dsp';
import { PRESETS } from '$lib/dsp';

export const load: PageServerLoad = () => ({
	profile: getDspProfile(),
	presets: PRESETS.map((p) => p.name),
	irs: listIrs()
});
