<script lang="ts">
	import type { PageData } from './$types';
	import TrackRow from '$lib/components/TrackRow.svelte';
	import { player } from '$lib/audio/player.svelte';
	import { formatDuration } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const tracks = $derived(data.tracks);
	const totalMs = $derived(tracks.reduce((s, t) => s + t.durationMs, 0));
</script>

<svelte:head><title>{data.playlist.name} · Timbre</title></svelte:head>

<header class="head">
	<span class="kind faint mono">PLAYLIST</span>
	<h1>{data.playlist.name}</h1>
	<div class="facts muted mono">{tracks.length} tracks · {formatDuration(totalMs)}</div>
	<div class="actions">
		<button class="btn btn-accent" onclick={() => tracks.length && player.playContext(tracks, 0)}>▶ Play</button>
		<button class="btn" onclick={() => { for (const t of tracks) player.enqueue(t); }}>＋ Queue</button>
	</div>
</header>

<section class="tracks">
	{#each tracks as t, i (t.id + '-' + i)}
		<TrackRow track={t} index={i + 1} showArtist onplay={() => player.playContext(tracks, i)} />
	{/each}
</section>

<style>
	.head {
		margin-bottom: 1.6rem;
	}
	.kind {
		font-size: 0.72rem;
		letter-spacing: 0.12em;
	}
	.head h1 {
		font-size: clamp(1.7rem, 3.5vw, 2.6rem);
		margin: 0.3rem 0 0.5rem;
	}
	.facts {
		font-size: 0.82rem;
		margin-bottom: 1rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
	}
	.tracks {
		max-width: 820px;
	}
</style>
