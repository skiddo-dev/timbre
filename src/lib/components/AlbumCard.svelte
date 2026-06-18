<script lang="ts">
	import type { Album } from '$lib/types';
	import Cover from './Cover.svelte';

	let { album }: { album: Album } = $props();
</script>

<a class="card" href={`/albums/${album.id}`}>
	<div class="art">
		<Cover albumId={album.id} hasArt={album.hasArt} alt={album.title} />
		<span class="play" aria-hidden="true">▶</span>
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
		position: relative;
		border-radius: 0;
		overflow: hidden;
		box-shadow: var(--shadow-sm);
		transition: transform 0.18s ease, box-shadow 0.18s ease;
		container-type: inline-size;
	}
	.card:hover .art {
		transform: translateY(-4px);
		box-shadow: var(--shadow);
		outline: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		outline-offset: -1px;
	}
	/* a play button rises from the bottom-right corner on hover */
	.play {
		position: absolute;
		right: 0.55rem;
		bottom: 0.55rem;
		width: 2.5rem;
		height: 2.5rem;
		display: grid;
		place-items: center;
		border-radius: 50%;
		font-size: 0.8rem;
		color: var(--accent-contrast);
		background: radial-gradient(circle at 50% 30%, var(--accent-strong), var(--accent));
		box-shadow: 0 6px 16px -4px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 255, 255, 0.25) inset;
		opacity: 0;
		transform: translateY(0.5rem) scale(0.85);
		transition: opacity 0.16s ease, transform 0.16s ease;
		pointer-events: none;
	}
	.card:hover .play {
		opacity: 1;
		transform: translateY(0) scale(1);
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
