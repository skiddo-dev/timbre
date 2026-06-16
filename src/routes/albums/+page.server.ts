import type { PageServerLoad } from './$types';
import { listAlbums, type AlbumSort } from '$lib/server/repo';

const SORTS: AlbumSort[] = ['added', 'title', 'artist', 'year'];

export const load: PageServerLoad = ({ url }) => {
	const s = url.searchParams.get('sort') as AlbumSort;
	const sort: AlbumSort = SORTS.includes(s) ? s : 'added';
	return { albums: listAlbums(sort), sort };
};
