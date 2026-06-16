import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAlbum, albumTracks, getArtistByName } from '$lib/server/repo';

export const load: PageServerLoad = ({ params }) => {
	const id = Number(params.id);
	const album = Number.isFinite(id) ? getAlbum(id) : null;
	if (!album) throw error(404, 'Album not found');
	const artist = getArtistByName(album.albumArtist);
	return { album, tracks: albumTracks(id), artistId: artist?.id ?? null };
};
