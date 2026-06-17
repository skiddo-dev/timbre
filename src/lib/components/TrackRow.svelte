<script lang="ts">
	import type { Track } from '$lib/types';
	import { formatDuration } from '$lib/format';
	import { player } from '$lib/audio/player.svelte';

	let {
		track,
		index,
		showArtist = false,
		onplay
	}: {
		track: Track;
		index?: number;
		showArtist?: boolean;
		onplay: () => void;
	} = $props();

	const active = $derived(player.current?.id === track.id);
</script>

<div class="row" class:active>
	<button class="num" onclick={onplay} title="Play">
		<span class="idx mono">{index ?? track.trackNo ?? '•'}</span>
		<span class="play">{active && player.playing ? '❚❚' : '▶'}</span>
	</button>
	<button class="main" onclick={onplay}>
		<span class="title">{track.title}</span>
		{#if showArtist}<span class="artist muted">{track.artist}</span>{/if}
	</button>
	<span class="stars" title={track.rating ? `${track.rating}/5` : ''}>{track.rating ? '★'.repeat(track.rating) : ''}</span>
	<button class="add" title="Add to queue" onclick={() => player.enqueue(track)}>＋</button>
	<span class="dur mono muted">{formatDuration(track.durationMs)}</span>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 2.4rem 1fr auto auto auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.3rem 0.5rem;
		border-radius: var(--radius-sm);
	}
	.stars {
		color: var(--accent);
		font-size: 0.72rem;
		letter-spacing: 1px;
		white-space: nowrap;
	}
	.row:hover {
		background: var(--surface-2);
	}
	.row.active {
		background: var(--surface-2);
	}
	.row.active .title {
		color: var(--accent);
	}
	button {
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		padding: 0;
	}
	.num {
		position: relative;
		width: 2.4rem;
		height: 2rem;
		display: grid;
		place-items: center;
	}
	.idx {
		color: var(--text-faint);
		font-size: 0.82rem;
	}
	.play {
		display: none;
		font-size: 0.7rem;
		color: var(--accent);
	}
	.row:hover .idx {
		display: none;
	}
	.row:hover .play {
		display: block;
	}
	.row.active .idx {
		display: none;
	}
	.row.active .play {
		display: block;
	}
	.main {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}
	.artist {
		font-size: 0.8rem;
	}
	.add {
		opacity: 0;
		font-size: 1.1rem;
		color: var(--text-dim);
		width: 1.6rem;
		text-align: center;
	}
	.row:hover .add {
		opacity: 1;
	}
	.add:hover {
		color: var(--accent);
	}
	.dur {
		font-size: 0.82rem;
		min-width: 3ch;
		text-align: right;
	}
</style>
