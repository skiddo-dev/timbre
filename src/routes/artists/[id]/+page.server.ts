import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getArtist, artistAlbums } from '$lib/server/repo';

export const load: PageServerLoad = ({ params }) => {
	const id = Number(params.id);
	const artist = Number.isFinite(id) ? getArtist(id) : null;
	if (!artist) throw error(404, 'Artist not found');
	return { artist, albums: artistAlbums(artist) };
};
