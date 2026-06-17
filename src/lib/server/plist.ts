// Minimal Apple plist (XML) → JS parser, enough for an iTunes/Music "Library.xml":
// nested dict/array + string/integer/real/true/false/date/data scalars. No deps.
// plist tags carry no attributes, which keeps the cursor scan simple.
type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s: string): string {
	return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
		if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' ? e.slice(2) : e.slice(1), e[1] === 'x' ? 16 : 10));
		return ENTITIES[e] ?? _;
	});
}

const skipWs = (s: string, i: number) => {
	while (i < s.length && (s[i] === ' ' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++;
	return i;
};

function parseValue(s: string, i: number): [PlistValue, number] {
	const close = s.indexOf('>', i);
	let tag = s.slice(i + 1, close);
	const selfClose = tag.endsWith('/');
	if (selfClose) tag = tag.slice(0, -1);
	tag = tag.trim().split(/\s/)[0];
	const after = close + 1;

	if (tag === 'true') return [true, after];
	if (tag === 'false') return [false, after];
	if (selfClose) {
		if (tag === 'array') return [[], after];
		if (tag === 'dict') return [{}, after];
		return ['', after];
	}
	if (tag === 'dict') return parseDict(s, after);
	if (tag === 'array') return parseArray(s, after);

	const end = s.indexOf(`</${tag}>`, after);
	const raw = s.slice(after, end);
	const next = end + tag.length + 3;
	if (tag === 'integer') return [parseInt(raw, 10), next];
	if (tag === 'real') return [parseFloat(raw), next];
	return [decode(raw), next]; // string | date | data
}

function parseDict(s: string, i: number): [Record<string, PlistValue>, number] {
	const obj: Record<string, PlistValue> = {};
	i = skipWs(s, i);
	while (!s.startsWith('</dict>', i)) {
		if (i >= s.length) break;
		const kOpen = s.indexOf('>', i); // end of <key>
		const kEnd = s.indexOf('</key>', kOpen + 1);
		const key = decode(s.slice(kOpen + 1, kEnd));
		i = skipWs(s, kEnd + 6);
		const [val, ni] = parseValue(s, i);
		obj[key] = val;
		i = skipWs(s, ni);
	}
	return [obj, i + 7];
}

function parseArray(s: string, i: number): [PlistValue[], number] {
	const arr: PlistValue[] = [];
	i = skipWs(s, i);
	while (!s.startsWith('</array>', i)) {
		if (i >= s.length) break;
		const [val, ni] = parseValue(s, i);
		arr.push(val);
		i = skipWs(s, ni);
	}
	return [arr, i + 8];
}

export function parsePlist(xml: string): Record<string, PlistValue> {
	let i = xml.indexOf('<plist');
	if (i < 0) throw new Error('not a plist');
	i = skipWs(xml, xml.indexOf('>', i) + 1);
	const [val] = parseValue(xml, i);
	if (typeof val !== 'object' || Array.isArray(val)) throw new Error('plist root is not a dict');
	return val;
}
