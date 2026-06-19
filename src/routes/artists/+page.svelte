<script lang="ts">
	import type { PageData } from './$types';
	import ArtistAvatar from '$lib/components/ArtistAvatar.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Artists · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Artists <span class="count mono muted">{data.artists.length}</span></h1>
</header>

{#if data.artists.length}
	<div class="grid">
		{#each data.artists as artist (artist.id)}
			<a class="cell" href={`/artists/${artist.id}`}>
				<div class="av"><ArtistAvatar {artist} /></div>
				<div class="name" title={artist.name}>{artist.name}</div>
			</a>
		{/each}
	</div>
{:else}
	<p class="muted">No artists yet. <a class="link-arrow" href="/settings">Scan your library <Icon name="arrow-right" size={13} /></a></p>
{/if}

<style>
	.page-head {
		margin-bottom: 1.5rem;
	}
	h1 {
		font-size: 1.9rem;
	}
	.count {
		font-size: 1rem;
		font-weight: 400;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 1.4rem 1.1rem;
	}
	.cell {
		text-align: center;
		min-width: 0;
	}
	.av {
		transition: transform 0.15s ease;
	}
	.cell:hover .av {
		transform: scale(1.03);
	}
	.name {
		margin-top: 0.6rem;
		font-weight: 500;
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@media (max-width: 680px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}
</style>
