import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPlaylist, playlistTracks } from '$lib/server/repo';

export const load: PageServerLoad = ({ params }) => {
	const id = Number(params.id);
	const playlist = Number.isFinite(id) ? getPlaylist(id) : null;
	if (!playlist) throw error(404, 'Playlist not found');
	return { playlist, tracks: playlistTracks(id) };
};
