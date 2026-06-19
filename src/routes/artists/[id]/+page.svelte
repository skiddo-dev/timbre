<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import AlbumGrid from '$lib/components/AlbumGrid.svelte';
	import ArtistAvatar from '$lib/components/ArtistAvatar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { player } from '$lib/audio/player.svelte';
	import { ambientColor } from '$lib/ambient';

	let { data }: { data: PageData } = $props();
	let enriching = $state(false);
	let radioLoading = $state(false);

	// hero wash, borrowed from the artist's first album cover
	let art = $state('var(--accent-rgb)');
	$effect(() => {
		const first = data.albums.find((a) => a.hasArt) ?? data.albums[0];
		let live = true;
		ambientColor(first?.hasArt ? first.id : null).then((rgb) => {
			if (live) art = rgb;
		});
		return () => {
			live = false;
		};
	});

	function regionName(code: string | null): string | null {
		if (!code) return null;
		try {
			return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
		} catch {
			return code;
		}
	}
	function lifeSpan(begin: number | null, end: number | null): string | null {
		if (begin && end) return `${begin}–${end}`;
		if (begin) return `since ${begin}`;
		if (end) return `until ${end}`;
		return null;
	}
	// Factual line from MusicBrainz: e.g. "Group · United States · since 1965".
	const mbFacts = $derived(
		[data.artist.mbType, regionName(data.artist.country), lifeSpan(data.artist.beginYear, data.artist.endYear)]
			.filter(Boolean)
			.join(' · ')
	);

	async function enrich() {
		enriching = true;
		await fetch(`/api/artists/${data.artist.id}/enrich`, { method: 'POST' }).catch(() => {});
		await invalidateAll();
		enriching = false;
	}

	async function radio() {
		radioLoading = true;
		try {
			const res = await fetch('/api/ai/radio', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ artistId: data.artist.id, count: 25 })
			});
			const { tracks } = await res.json();
			if (tracks?.length) player.playContext(tracks, 0);
		} finally {
			radioLoading = false;
		}
	}
</script>

<svelte:head><title>{data.artist.name} · Timbre</title></svelte:head>

<header class="hero" style:--art={art}>
	<div class="av"><ArtistAvatar artist={data.artist} /></div>
	<div class="info">
		<span class="kind eyebrow">ARTIST</span>
		<h1>{data.artist.name}</h1>
		<div class="facts muted mono">{data.albums.length} albums in library</div>
		{#if mbFacts}
			<div class="facts muted mono">{mbFacts}</div>
		{/if}
		{#if data.artist.genres.length}
			<div class="chips">
				{#each data.artist.genres as g (g)}<span class="chip">{g}</span>{/each}
			</div>
		{/if}
		{#if data.artist.bio}
			<p class="bio">{data.artist.bio}</p>
		{/if}
		<div class="actions">
			<button class="btn btn-accent" onclick={radio} disabled={radioLoading}>
				{#if radioLoading}…{:else}<Icon name="radio" size={15} /> Artist radio{/if}
			</button>
			<button class="btn" onclick={enrich} disabled={enriching}>
				{enriching ? 'Fetching…' : data.artist.bio || data.artist.mbid ? 'Refresh metadata' : 'Fetch metadata'}
			</button>
		</div>
	</div>
</header>

<section>
	<h2>Albums</h2>
	{#if data.albums.length}
		<AlbumGrid albums={data.albums} />
	{:else}
		<p class="muted">No albums for this artist.</p>
	{/if}
</section>

<style>
	.hero {
		position: relative;
		display: flex;
		gap: 1.8rem;
		margin-bottom: 2.4rem;
		align-items: flex-end;
	}
	.hero::before {
		content: '';
		position: absolute;
		top: -1.6rem;
		left: -2rem;
		right: -2rem;
		height: 360px;
		z-index: -1;
		pointer-events: none;
		background: radial-gradient(110% 130% at 16% -20%, rgb(var(--art) / 0.28), transparent 60%);
		-webkit-mask-image: linear-gradient(180deg, #000 55%, transparent);
		mask-image: linear-gradient(180deg, #000 55%, transparent);
		transition: background 0.6s ease;
	}
	.av {
		width: 180px;
		flex: none;
		box-shadow: var(--shadow), 0 12px 40px -14px rgb(var(--art) / 0.5);
		border-radius: 50%;
		transition: box-shadow 0.6s ease;
	}
	.info {
		min-width: 0;
		max-width: 640px;
	}
	.kind {
		font-size: 0.72rem;
		letter-spacing: 0.12em;
	}
	.info h1 {
		font-size: clamp(1.8rem, 4vw, 3rem);
		margin: 0.3rem 0 0.5rem;
	}
	.facts {
		font-size: 0.82rem;
		margin-bottom: 0.4rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.5rem 0 0.8rem;
	}
	.bio {
		color: var(--text-dim);
		font-size: 0.92rem;
		line-height: 1.6;
		margin: 0 0 1rem;
		max-height: 7.5em;
		overflow: hidden;
		-webkit-mask-image: linear-gradient(180deg, #000 70%, transparent);
		mask-image: linear-gradient(180deg, #000 70%, transparent);
	}
	section h2 {
		font-size: 1.15rem;
		margin-bottom: 1rem;
	}
	@media (max-width: 680px) {
		.hero {
			flex-direction: column;
			align-items: center;
			text-align: center;
		}
		.av {
			width: 140px;
		}
	}
</style>
