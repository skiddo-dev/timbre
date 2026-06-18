// NZB parser. An NZB is a tiny XML manifest: one <file> per posted file, each
// carrying the Usenet <groups> it lives in and the ordered <segments> (article
// message-ids) that make it up. Hand-parsed with scoped regex — the format is small
// and well-formed — mirroring plist.ts, so there's no XML dependency.

export interface NzbSegment {
	number: number;
	bytes: number;
	messageId: string; // stored WITHOUT angle brackets; NNTP BODY needs <…>
}

export interface NzbFile {
	subject: string;
	filename: string;
	groups: string[];
	segments: NzbSegment[];
	bytes: number;
}

export interface Nzb {
	files: NzbFile[];
	totalBytes: number;
}

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'"
};

/** XML entity decode (named + numeric). Shared with the Newznab parser. */
export function unescapeXml(s: string): string {
	return s
		.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
		.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// yEnc subjects usually embed the real filename in double quotes, e.g.
//   [1/8] - "Artist - Album (2003)/01 Track.flac" yEnc (1/42)
function filenameFromSubject(subject: string): string {
	const quoted = subject.match(/"([^"]+)"/);
	if (quoted) return quoted[1].trim();
	const withExt = subject.match(/([^\s"/\\]+\.[A-Za-z0-9]{1,4})\b/);
	return (withExt ? withExt[1] : subject.slice(0, 80)).trim() || 'file.bin';
}

export function parseNzb(xml: string): Nzb {
	const files: NzbFile[] = [];
	const fileRe = /<file\b([^>]*)>([\s\S]*?)<\/file>/gi;
	let fm: RegExpExecArray | null;
	while ((fm = fileRe.exec(xml))) {
		const attrs = fm[1];
		const inner = fm[2];
		const subjMatch = attrs.match(/subject\s*=\s*"([^"]*)"/i);
		const subject = unescapeXml(subjMatch ? subjMatch[1] : '');

		const groups: string[] = [];
		const gRe = /<group>\s*([\s\S]*?)\s*<\/group>/gi;
		let gm: RegExpExecArray | null;
		while ((gm = gRe.exec(inner))) groups.push(unescapeXml(gm[1].trim()));

		const segments: NzbSegment[] = [];
		let bytes = 0;
		const sRe = /<segment\b([^>]*)>\s*([\s\S]*?)\s*<\/segment>/gi;
		let sm: RegExpExecArray | null;
		while ((sm = sRe.exec(inner))) {
			const sAttrs = sm[1];
			const number = Number((sAttrs.match(/number\s*=\s*"(\d+)"/i) || [])[1] || 0);
			const segBytes = Number((sAttrs.match(/bytes\s*=\s*"(\d+)"/i) || [])[1] || 0);
			const messageId = unescapeXml(sm[2].trim()).replace(/^<|>$/g, '');
			if (!messageId) continue;
			segments.push({ number, bytes: segBytes, messageId });
			bytes += segBytes;
		}
		segments.sort((a, b) => a.number - b.number);
		if (segments.length) {
			files.push({ subject, filename: filenameFromSubject(subject), groups, segments, bytes });
		}
	}
	return { files, totalBytes: files.reduce((n, f) => n + f.bytes, 0) };
}
