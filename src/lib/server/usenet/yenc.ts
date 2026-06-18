// yEnc article assembly. Given the raw body lines of one Usenet article (already
// NNTP-decoded + dot-unstuffed by nntp.ts), drop the =ybegin/=ypart/=yend keyword
// lines, concatenate the data, and decode it through the hand-authored kernel
// (src/lib/wasm/audio → yencDecode). The =ypart/=yend headers carry the part's byte
// range, declared size and crc32, which the caller can use for integrity checks.
import { yencDecode } from '$lib/wasm/audio';

export interface YencPart {
	data: Uint8Array;
	size: number | null; // =yend size, if present
	crc32: string | null; // pcrc32 (per-part) or crc32 (whole file), lowercased hex
	begin: number | null; // =ypart begin — 1-based byte offset within the file
	end: number | null; // =ypart end
}

function attr(line: string, key: string): string | null {
	const m = line.match(new RegExp(`\\b${key}=(\\S+)`, 'i'));
	return m ? m[1] : null;
}
function num(s: string | null): number | null {
	if (s == null) return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

/** Decode one article's body lines into its (partial) binary payload. */
export function decodeYencArticle(lines: Uint8Array[]): YencPart {
	const dataLines: Uint8Array[] = [];
	let size: number | null = null;
	let crc32: string | null = null;
	let begin: number | null = null;
	let end: number | null = null;

	for (const line of lines) {
		// A keyword line starts with the ASCII bytes "=y". yEnc escape sequences are
		// also "=…", so confirm the actual keyword before treating it as a header.
		if (line.length >= 2 && line[0] === 0x3d && line[1] === 0x79) {
			const text = Buffer.from(line).toString('latin1');
			if (text.startsWith('=ybegin')) {
				continue;
			} else if (text.startsWith('=ypart')) {
				begin = num(attr(text, 'begin'));
				end = num(attr(text, 'end'));
				continue;
			} else if (text.startsWith('=yend')) {
				size = num(attr(text, 'size'));
				crc32 = (attr(text, 'pcrc32') || attr(text, 'crc32') || '').toLowerCase() || null;
				continue;
			}
		}
		dataLines.push(line);
	}

	return { data: yencDecode(concat(dataLines)), size, crc32, begin, end };
}

function concat(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}
