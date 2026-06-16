<script lang="ts">
	import type { Album } from '$lib/types';
	import AlbumCard from './AlbumCard.svelte';

	let { albums }: { albums: Album[] } = $props();
</script>

<div class="grid">
	{#each albums as album (album.id)}
		<AlbumCard {album} />
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 1.3rem 1.1rem;
	}
	@media (max-width: 680px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
			gap: 1rem 0.8rem;
		}
	}
</style>
