<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import Cover from '$lib/components/Cover.svelte';
	import TrackRow from '$lib/components/TrackRow.svelte';
	import { player } from '$lib/audio/player.svelte';
	import { formatDuration, qualityLabel } from '$lib/format';
	import { ambientColor } from '$lib/ambient';

	let { data }: { data: PageData } = $props();
	const tracks = $derived(data.tracks);

	// soft colour wash behind the hero, pulled from the cover art
	let art = $state('var(--accent-rgb)');
	$effect(() => {
		const id = data.album.hasArt ? data.album.id : null;
		let live = true;
		ambientColor(id).then((rgb) => {
			if (live) art = rgb;
		});
		return () => {
			live = false;
		};
	});

	let enriching = $state(false);
	async function enrich() {
		enriching = true;
		await fetch(`/api/albums/${data.album.id}/enrich`, { method: 'POST' }).catch(() => {});
		await invalidateAll();
		enriching = false;
	}

	// Release kind from MusicBrainz: a secondary type (Live/Compilation/Soundtrack)
	// or a non-Album primary type (EP/Single). Plain albums show nothing.
	const releaseKind = $derived(
		data.album.mbSecondaryTypes[0] ??
			(data.album.mbPrimaryType && data.album.mbPrimaryType !== 'Album' ? data.album.mbPrimaryType : null)
	);

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

<header class="hero" style:--art={art}>
	<div class="art">
		<Cover albumId={data.album.id} hasArt={data.album.hasArt} alt={data.album.title} radius="0" />
	</div>
	<div class="info">
		<span class="kind eyebrow">{releaseKind ? releaseKind.toUpperCase() : 'ALBUM'}</span>
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
		{#if data.album.mbGenres.length || data.album.genre || data.album.mood || data.album.tags.length}
			<div class="ai-chips">
				{#each data.album.mbGenres as g (g)}<span class="chip">{g}</span>{/each}
				{#if data.album.genre}<span class="chip faint">{data.album.genre}</span>{/if}
				{#if data.album.mood}<span class="chip faint">{data.album.mood}</span>{/if}
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
			<button class="btn" onclick={enrich} disabled={enriching}>{enriching ? 'Fetching…' : data.album.mbid ? 'Refresh metadata' : 'Fetch metadata'}</button>
			{#if data.album.appleUrl}
				<a class="btn" href={data.album.appleUrl} target="_blank" rel="noopener noreferrer" title="Open in Apple Music">Apple Music ↗</a>
			{/if}
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
		position: relative;
		display: flex;
		gap: 1.8rem;
		margin-bottom: 2rem;
		align-items: flex-end;
	}
	/* full-bleed colour wash bleeding to the content edges, behind the hero */
	.hero::before {
		content: '';
		position: absolute;
		top: -1.6rem;
		left: -2rem;
		right: -2rem;
		height: 380px;
		z-index: -1;
		pointer-events: none;
		background: radial-gradient(120% 130% at 18% -20%, rgb(var(--art) / 0.42), transparent 64%);
		-webkit-mask-image: linear-gradient(180deg, #000 55%, transparent);
		mask-image: linear-gradient(180deg, #000 55%, transparent);
		transition: background 0.6s ease;
	}
	.art {
		width: 230px;
		flex: none;
		box-shadow: var(--shadow), 0 12px 40px -12px rgb(var(--art) / 0.55);
		border-radius: 0;
		overflow: hidden;
		transition: box-shadow 0.6s ease;
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
