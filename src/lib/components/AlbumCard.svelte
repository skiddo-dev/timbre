<script lang="ts">
	import type { Album } from '$lib/types';
	import Cover from './Cover.svelte';

	let { album }: { album: Album } = $props();
</script>

<a class="card" href={`/albums/${album.id}`}>
	<div class="art">
		<Cover albumId={album.id} hasArt={album.hasArt} alt={album.title} />
	</div>
	<div class="title" title={album.title}>{album.title}</div>
	<div class="sub muted" title={album.albumArtist}>
		{album.albumArtist}{#if album.year} · <span class="mono">{album.year}</span>{/if}
	</div>
</a>

<style>
	.card {
		display: block;
		min-width: 0;
	}
	.art {
		border-radius: var(--radius);
		overflow: hidden;
		box-shadow: var(--shadow-sm);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
		container-type: inline-size;
	}
	.card:hover .art {
		transform: translateY(-3px);
		box-shadow: var(--shadow);
	}
	.title {
		margin-top: 0.55rem;
		font-weight: 600;
		font-size: 0.92rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
