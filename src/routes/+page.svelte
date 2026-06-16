<script lang="ts">
	import type { PageData } from './$types';
	import AlbumGrid from '$lib/components/AlbumGrid.svelte';
	import Cover from '$lib/components/Cover.svelte';
	import { player } from '$lib/audio/player.svelte';

	let { data }: { data: PageData } = $props();
	const empty = $derived(data.stats.tracks === 0);
</script>

<svelte:head><title>Timbre</title></svelte:head>

{#if empty}
	<div class="empty">
		<div class="logo">◉</div>
		<h1>Welcome to Timbre</h1>
		<p class="muted">
			A no-subscription, self-hosted music player. Point it at your music folder and Timbre will
			build a library — artwork, metadata and all — right here on this machine.
		</p>
		<a class="btn btn-accent" href="/settings">Choose your music folder →</a>
	</div>
{:else}
	<header class="page-head">
		<h1>Home</h1>
		<p class="muted mono small">
			{data.stats.tracks} tracks · {data.stats.albums} albums · {data.stats.artists} artists
		</p>
	</header>

	{#if data.recent.length}
		<section>
			<h2>Jump back in</h2>
			<div class="recent">
				{#each data.recent as t (t.id)}
					<button class="recent-card" onclick={() => player.playContext([t], 0)}>
						<div class="rc-art"><Cover albumId={t.albumId} alt={t.title} /></div>
						<div class="rc-meta">
							<div class="rc-title">{t.title}</div>
							<div class="rc-artist muted">{t.artist}</div>
						</div>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<section>
		<div class="sec-head">
			<h2>Recently added</h2>
			<a class="muted small" href="/albums">All albums →</a>
		</div>
		<AlbumGrid albums={data.albums} />
	</section>
{/if}

<style>
	.empty {
		max-width: 520px;
		margin: 12vh auto 0;
		text-align: center;
	}
	.logo {
		font-size: 3rem;
		color: var(--accent);
	}
	.empty h1 {
		font-size: 2rem;
		margin: 0.6rem 0 0.8rem;
	}
	.empty p {
		margin-bottom: 1.6rem;
		line-height: 1.6;
	}
	.page-head {
		margin-bottom: 1.6rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.small {
		font-size: 0.82rem;
	}
	section {
		margin-bottom: 2.4rem;
	}
	section h2 {
		font-size: 1.15rem;
		margin-bottom: 1rem;
	}
	.sec-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 1rem;
	}
	.recent {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 0.7rem;
	}
	.recent-card {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
		text-align: left;
		min-width: 0;
		transition: background 0.12s ease;
	}
	.recent-card:hover {
		background: var(--surface-2);
	}
	.rc-art {
		width: 46px;
		flex: none;
		border-radius: 6px;
		overflow: hidden;
	}
	.rc-meta {
		min-width: 0;
	}
	.rc-title {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rc-artist {
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
