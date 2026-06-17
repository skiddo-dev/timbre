<script lang="ts">
	import type { PageData } from './$types';
	import Cover from '$lib/components/Cover.svelte';
	import TrackRow from '$lib/components/TrackRow.svelte';
	import { player } from '$lib/audio/player.svelte';
	import { formatDuration, qualityLabel } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const tracks = $derived(data.tracks);

	function playAlbum() {
		if (tracks.length) player.playContext(tracks, 0);
	}
	function shuffleAlbum() {
		if (!tracks.length) return;
		if (!player.shuffle) player.toggleShuffle();
		player.playContext(tracks, Math.floor(Math.random() * tracks.length));
	}
	function queueAlbum() {
		for (const t of tracks) player.enqueue(t);
	}

	let radioLoading = $state(false);
	async function radio() {
		radioLoading = true;
		try {
			const res = await fetch('/api/ai/radio', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ albumId: data.album.id, count: 25 })
			});
			const { tracks: rt } = await res.json();
			if (rt?.length) player.playContext(rt, 0);
		} finally {
			radioLoading = false;
		}
	}

	const totalMs = $derived(tracks.reduce((s, t) => s + t.durationMs, 0));
	const quality = $derived(tracks[0] ? qualityLabel(tracks[0]) : '');
	// disc boundaries for headers (only shown when >1 disc)
	const discs = $derived([...new Set(tracks.map((t) => t.discNo ?? 1))]);
</script>

<svelte:head><title>{data.album.title} · Timbre</title></svelte:head>

<header class="hero">
	<div class="art">
		<Cover albumId={data.album.id} hasArt={data.album.hasArt} alt={data.album.title} radius="var(--radius-lg)" />
	</div>
	<div class="info">
		<span class="kind faint mono">ALBUM</span>
		<h1>{data.album.title}</h1>
		<div class="by">
			{#if data.artistId}
				<a href={`/artists/${data.artistId}`}>{data.album.albumArtist}</a>
			{:else}
				<span>{data.album.albumArtist}</span>
			{/if}
		</div>
		<div class="facts muted mono">
			{#if data.album.year}{data.album.year} · {/if}{tracks.length} tracks · {formatDuration(totalMs)}{#if quality} · {quality}{/if}
		</div>
		{#if data.album.genre || data.album.mood || data.album.tags.length}
			<div class="ai-chips">
				{#if data.album.genre}<span class="chip">{data.album.genre}</span>{/if}
				{#if data.album.mood}<span class="chip">{data.album.mood}</span>{/if}
				{#each data.album.tags as tag (tag)}<span class="chip faint">{tag}</span>{/each}
			</div>
		{/if}
		{#if data.album.descriptor}
			<p class="descriptor muted">{data.album.descriptor}</p>
		{/if}
		<div class="actions">
			<button class="btn btn-accent" onclick={playAlbum}>▶ Play</button>
			<button class="btn" onclick={shuffleAlbum}>⤮ Shuffle</button>
			<button class="btn" onclick={radio} disabled={radioLoading}>{radioLoading ? '…' : '📻 Radio'}</button>
			<button class="btn" onclick={queueAlbum}>＋ Queue</button>
		</div>
	</div>
</header>

<section class="tracks">
	{#each discs as disc (disc)}
		{#if discs.length > 1}
			<h3 class="disc faint mono">Disc {disc}</h3>
		{/if}
		{#each tracks as t, i (t.id)}
			{#if (t.discNo ?? 1) === disc}
				<TrackRow track={t} index={t.trackNo ?? i + 1} onplay={() => player.playContext(tracks, i)} />
			{/if}
		{/each}
	{/each}
</section>

<style>
	.hero {
		display: flex;
		gap: 1.8rem;
		margin-bottom: 2rem;
		align-items: flex-end;
	}
	.art {
		width: 230px;
		flex: none;
		box-shadow: var(--shadow);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.info {
		min-width: 0;
		padding-bottom: 0.4rem;
	}
	.kind {
		font-size: 0.72rem;
		letter-spacing: 0.12em;
	}
	.info h1 {
		font-size: clamp(1.8rem, 4vw, 3rem);
		line-height: 1.05;
		margin: 0.3rem 0 0.5rem;
	}
	.by {
		font-size: 1.05rem;
		font-weight: 500;
		margin-bottom: 0.5rem;
	}
	.by a:hover {
		color: var(--accent);
	}
	.facts {
		font-size: 0.82rem;
		margin-bottom: 0.7rem;
	}
	.ai-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: 0.6rem;
	}
	.descriptor {
		font-size: 0.88rem;
		max-width: 540px;
		margin: 0 0 1rem;
		line-height: 1.5;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
	}
	.tracks {
		max-width: 820px;
	}
	.disc {
		font-size: 0.75rem;
		letter-spacing: 0.1em;
		margin: 1rem 0 0.3rem 0.5rem;
	}
	@media (max-width: 680px) {
		.hero {
			flex-direction: column;
			align-items: stretch;
		}
		.art {
			width: 60%;
			max-width: 230px;
		}
	}
</style>
