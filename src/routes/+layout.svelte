<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import NowPlaying from '$lib/components/NowPlaying.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons';

	let { children } = $props();

	const nav: { href: string; label: string; icon: IconName }[] = [
		{ href: '/', label: 'Home', icon: 'home' },
		{ href: '/albums', label: 'Albums', icon: 'albums' },
		{ href: '/artists', label: 'Artists', icon: 'artists' },
		{ href: '/playlists', label: 'Playlists', icon: 'playlists' },
		{ href: '/radio', label: 'Radio', icon: 'radio' },
		{ href: '/subsonic', label: 'Streaming', icon: 'stream' },
		{ href: '/usenet', label: 'Usenet', icon: 'download' },
		{ href: '/search', label: 'Search', icon: 'search' },
		{ href: '/zones', label: 'Zones', icon: 'zones' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

	const active = (href: string, path: string) =>
		href === '/' ? path === '/' : path.startsWith(href);
</script>

<div class="app">
	<aside class="sidebar">
		<a href="/" class="brand">
			<span class="brand-mark"><Icon name="logo" size={22} /></span>
			<span class="brand-name">Timbre</span>
		</a>
		<nav>
			{#each nav as item (item.href)}
				<a href={item.href} class="nav-link" class:active={active(item.href, $page.url.pathname)}>
					<span class="nav-icon"><Icon name={item.icon} size={20} /></span>
					{item.label}
				</a>
			{/each}
		</nav>
		<div class="sidebar-foot faint">Local-first · no subscription</div>
	</aside>

	<main class="content">
		{@render children()}
	</main>

	<NowPlaying />
</div>

<style>
	.app {
		display: grid;
		grid-template-columns: var(--sidebar-w) 1fr;
		min-height: 100vh;
	}
	.sidebar {
		position: sticky;
		top: 0;
		align-self: start;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1.1rem 0.85rem;
		background: linear-gradient(180deg, var(--surface), color-mix(in srgb, var(--surface) 80%, var(--bg)));
		border-right: 1px solid var(--border-soft);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.6rem 1rem;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.25rem;
		letter-spacing: -0.02em;
	}
	.brand-mark {
		display: inline-flex;
		color: var(--accent);
		filter: drop-shadow(0 0 10px rgba(224, 164, 92, 0.65));
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.nav-link {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0.7rem;
		border-radius: var(--radius-sm);
		color: var(--text-dim);
		font-weight: 500;
		transition: background 0.12s ease, color 0.12s ease;
	}
	.nav-link:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.nav-link.active {
		background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 80%);
		color: var(--text);
	}
	/* an accent rail marks the current section */
	.nav-link.active::before {
		content: '';
		position: absolute;
		left: -0.1rem;
		top: 50%;
		transform: translateY(-50%);
		width: 3px;
		height: 1.1rem;
		border-radius: 0 3px 3px 0;
		background: var(--accent);
		box-shadow: 0 0 10px rgba(224, 164, 92, 0.7);
	}
	.nav-link.active .nav-icon {
		color: var(--accent);
	}
	.nav-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.3rem;
		color: var(--text-faint);
	}
	.sidebar-foot {
		margin-top: auto;
		padding: 0.6rem;
		font-size: 0.72rem;
	}
	.content {
		min-width: 0;
		padding: 1.6rem 2rem calc(var(--dock-h) + 2rem);
		/* lets hero colour-washes bleed to the content edges without page scroll */
		overflow-x: clip;
	}
	@media (max-width: 680px) {
		.app {
			grid-template-columns: 1fr;
		}
		.sidebar {
			position: fixed;
			bottom: 0;
			top: auto;
			left: 0;
			right: 0;
			height: auto;
			flex-direction: row;
			z-index: 40;
			padding: 0.4rem;
			border-right: none;
			border-top: 1px solid var(--border-soft);
		}
		.brand,
		.sidebar-foot {
			display: none;
		}
		.sidebar nav {
			flex-direction: row;
			width: 100%;
			justify-content: space-around;
		}
		.nav-link {
			flex-direction: column;
			gap: 0.2rem;
			font-size: 0.7rem;
		}
		.nav-link.active {
			background: none;
		}
		.nav-link.active::before {
			display: none;
		}
		.content {
			padding: 1rem 1rem calc(var(--dock-h) + 4rem);
		}
	}
</style>
