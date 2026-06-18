// Best-effort archive handling for the built-in NNTP engine. PAR2 repair and
// RAR/7z extraction are delegated to external binaries IF they happen to be on PATH
// (par2, then unrar or 7z) — exactly like loudness.ts treats ffmpeg as optional and
// silently skips it. Real Usenet music is usually posted as multi-part RAR + PAR2;
// without these tools the NNTP fallback only handles directly-posted audio, which is
// the whole reason a SABnzbd client is the recommended primary engine.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function binExists(bin: string): boolean {
	try {
		// ENOENT (missing binary) sets `error`; a non-zero help/usage exit does not.
		const r = spawnSync(bin, ['--help'], { stdio: 'ignore', timeout: 5000 });
		return !r.error;
	} catch {
		return false;
	}
}

/** Repair + unpack any archives in `dir`, best-effort. Never throws. */
export function maybeExtract(dir: string): void {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	const lower = names.map((n) => n.toLowerCase());

	// 1) PAR2 verify/repair if a recovery set is present and par2 is installed.
	const par2Idx = lower.findIndex((n) => n.endsWith('.par2'));
	if (par2Idx >= 0 && binExists('par2')) {
		run('par2', ['repair', '-q', join(dir, names[par2Idx])], dir);
	}

	// 2) Unpack the first RAR volume (.rar or .r00) with unrar or 7z.
	const rarIdx = lower.findIndex((n) => n.endsWith('.rar') || /\.r00$/.test(n));
	if (rarIdx >= 0) {
		const archive = join(dir, names[rarIdx]);
		if (binExists('unrar')) run('unrar', ['x', '-o+', '-y', archive], dir);
		else if (binExists('7z')) run('7z', ['x', '-y', archive], dir);
	}
}

function run(bin: string, args: string[], cwd: string): void {
	try {
		spawnSync(bin, args, { cwd, stdio: 'ignore', timeout: 600_000 });
	} catch {
		/* extraction is best-effort */
	}
}
