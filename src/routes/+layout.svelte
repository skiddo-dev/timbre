<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import NowPlaying from '$lib/components/NowPlaying.svelte';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Home', icon: '◉' },
		{ href: '/albums', label: 'Albums', icon: '▦' },
		{ href: '/artists', label: 'Artists', icon: '☻' },
		{ href: '/playlists', label: 'Playlists', icon: '≣' },
		{ href: '/radio', label: 'Radio', icon: '◍' },
		{ href: '/usenet', label: 'Usenet', icon: '⇣' },
		{ href: '/search', label: 'Search', icon: '⌕' },
		{ href: '/zones', label: 'Zones', icon: '◫' },
		{ href: '/settings', label: 'Settings', icon: '⚙' }
	];

	const active = (href: string, path: string) =>
		href === '/' ? path === '/' : path.startsWith(href);
</script>

<div class="app">
	<aside class="sidebar">
		<a href="/" class="brand">
			<span class="brand-mark">◉</span>
			<span class="brand-name">Timbre</span>
		</a>
		<nav>
			{#each nav as item (item.href)}
				<a href={item.href} class="nav-link" class:active={active(item.href, $page.url.pathname)}>
					<span class="nav-icon">{item.icon}</span>
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
		color: var(--accent);
		font-size: 1.1rem;
		text-shadow: 0 0 14px rgba(224, 164, 92, 0.7);
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
		width: 1.2rem;
		text-align: center;
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
