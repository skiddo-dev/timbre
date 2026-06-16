<script lang="ts">
	import { page } from '$app/stores';
</script>

<div class="err">
	<div class="code mono">{$page.status}</div>
	<h1>{$page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p class="muted">{$page.error?.message ?? 'An unexpected error occurred.'}</p>
	<a class="btn" href="/">← Back home</a>
</div>

<style>
	.err {
		max-width: 460px;
		margin: 14vh auto 0;
		text-align: center;
	}
	.code {
		font-size: 4rem;
		font-weight: 700;
		color: var(--accent);
		line-height: 1;
	}
	.err h1 {
		font-size: 1.5rem;
		margin: 0.5rem 0 0.6rem;
	}
	.err p {
		margin-bottom: 1.4rem;
	}
</style>
