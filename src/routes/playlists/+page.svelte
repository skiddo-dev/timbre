<script lang="ts">
	import type { PageData } from './$types';
	import Icon from '$lib/components/Icon.svelte';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Playlists · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Playlists <span class="count mono muted">{data.playlists.length}</span></h1>
</header>

{#if data.playlists.length}
	<ul class="list">
		{#each data.playlists as p (p.id)}
			<li>
				<a href={`/playlists/${p.id}`}>
					<span class="icon" aria-hidden="true"><Icon name="playlists" size={18} /></span>
					<span class="name">{p.name}</span>
					<span class="meta mono muted">{p.trackCount} tracks</span>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<p class="muted">
		No playlists yet. Import them from your Music library in <a href="/settings">Settings</a>.
	</p>
{/if}

<style>
	.page-head {
		margin-bottom: 1.4rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.count {
		font-size: 1rem;
		font-weight: 400;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-width: 720px;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.list a {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.7rem 0.9rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}
	.list a:hover {
		background: var(--surface-2);
		border-color: var(--accent-dim);
	}
	.icon {
		color: var(--accent);
	}
	.name {
		font-weight: 600;
		flex: 1;
	}
	.meta {
		font-size: 0.8rem;
	}
</style>
