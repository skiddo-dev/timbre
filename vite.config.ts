import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// node:sqlite is a Node builtin — keep it external to the SSR bundle.
	ssr: { external: ['node:sqlite'] }
});
