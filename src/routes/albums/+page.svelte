<script lang="ts">
	import type { PageData } from './$types';
	import AlbumGrid from '$lib/components/AlbumGrid.svelte';

	let { data }: { data: PageData } = $props();
	const sorts = [
		{ key: 'added', label: 'Recently added' },
		{ key: 'title', label: 'Title' },
		{ key: 'artist', label: 'Artist' },
		{ key: 'year', label: 'Year' }
	];
</script>

<svelte:head><title>Albums · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Albums <span class="count mono muted">{data.albums.length}</span></h1>
	<div class="sorts">
		{#each sorts as s (s.key)}
			<a
				href={`/albums?sort=${s.key}`}
				class="sort"
				class:active={data.sort === s.key}
				data-sveltekit-noscroll>{s.label}</a
			>
		{/each}
	</div>
</header>

{#if data.albums.length}
	<AlbumGrid albums={data.albums} />
{:else}
	<p class="muted">No albums yet. <a href="/settings">Scan your library →</a></p>
{/if}

<style>
	.page-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.8rem;
		margin-bottom: 1.5rem;
	}
	h1 {
		font-size: 1.9rem;
	}
	.count {
		font-size: 1rem;
		font-weight: 400;
	}
	.sorts {
		display: flex;
		gap: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		padding: 0.25rem;
	}
	.sort {
		padding: 0.3rem 0.8rem;
		border-radius: 999px;
		font-size: 0.85rem;
		color: var(--text-dim);
	}
	.sort:hover {
		color: var(--text);
	}
	.sort.active {
		background: var(--surface-3);
		color: var(--text);
	}
</style>
