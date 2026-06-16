<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import AlbumGrid from '$lib/components/AlbumGrid.svelte';
	import ArtistAvatar from '$lib/components/ArtistAvatar.svelte';

	let { data }: { data: PageData } = $props();
	let enriching = $state(false);

	async function enrich() {
		enriching = true;
		await fetch(`/api/artists/${data.artist.id}/enrich`, { method: 'POST' }).catch(() => {});
		await invalidateAll();
		enriching = false;
	}
</script>

<svelte:head><title>{data.artist.name} · Timbre</title></svelte:head>

<header class="hero">
	<div class="av"><ArtistAvatar artist={data.artist} /></div>
	<div class="info">
		<span class="kind faint mono">ARTIST</span>
		<h1>{data.artist.name}</h1>
		<div class="facts muted mono">{data.albums.length} albums in library</div>
		{#if data.artist.bio}
			<p class="bio">{data.artist.bio}</p>
		{/if}
		<div class="actions">
			<button class="btn" onclick={enrich} disabled={enriching}>
				{enriching ? 'Fetching…' : data.artist.bio ? 'Refresh bio & image' : 'Fetch bio & image'}
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
		display: flex;
		gap: 1.8rem;
		margin-bottom: 2.4rem;
		align-items: flex-end;
	}
	.av {
		width: 180px;
		flex: none;
		box-shadow: var(--shadow);
		border-radius: 50%;
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
		margin-bottom: 0.8rem;
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
