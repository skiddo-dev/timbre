// Seed a "Crate Diggers' Blogroll" playlist from a hand-curated set of records
// featured on 16 well-known music blogs (Thai luk thung, Indonesian, Moroccan
// cassettes, global pop oddities, punk/experimental tapes, …).
//
// These blogs share music as file-host DOWNLOADS — they don't stream — and
// Timbre only plays local files. So each entry is a non-local 'blog' crate track:
// real artist + release metadata, browsable/searchable in the app, with a link
// back to the blog (TrackRow shows a "↗"). They won't play until you source the
// files; this is a listening guide / wantlist, not a stream.
//
// One album per blog (source='blog', grouped as a crate), plus the playlist that
// spans them all. Idempotent: re-running wipes the previous blogroll first.
//
//   node scripts/seed-blogroll.mjs            # seeds data/timbre.db
//   DATABASE_PATH=/tmp/x.db node scripts/seed-blogroll.mjs
//
// Restart the dev server afterwards if it's running (HMR won't re-open the DB).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DATABASE_PATH || 'data/timbre.db';
const PLAYLIST_NAME = "Crate Diggers' Blogroll";
const PLAYLIST_PID = 'blogroll:crate-diggers';

// ── the crate ────────────────────────────────────────────────────────────────
// Each blog → an album, with its featured releases as `tracks` (artist · title).
const BLOGS = [
	{
		slug: 'monrakplengthai',
		name: 'Monrak Plengthai',
		url: 'https://monrakplengthai.blogspot.com/',
		genre: 'Luk Thung / Molam',
		mood: 'Nostalgic',
		tags: ['Thailand', 'Isan', 'molam', 'cassette'],
		descriptor: 'Classic Thai country (luk thung) and Isan molam, ripped from vinyl and cassette.',
		tracks: [
			['Chintara Phunlap', 'Vol. 16 "Chao Bao Hai"'],
			['The Shangri-La', 'Kin Arai Thueng Suai'],
			['Charin Nanthanakhon', 'Mon Rak Dok Kham Tai'],
			['Sunari Ratchasima', 'Chip To'],
			['Sombat Chimrat', 'Lai Hua Non Tan'],
			['Kung Tuangsit Riamchinda', 'Super Hit'],
			['Denchai Sai-Suphan', 'Khai Chai'],
			['Noknoi Uraiphon', 'Khoi Rak Chak Siang Phin'],
			['Suraphon Sombatcharoen', 'Luk Thung Lueat Suphan']
		]
	},
	{
		slug: 'soi48',
		name: 'Soi48',
		url: 'http://soi48.blogspot.com/',
		genre: 'Molam / Luk Thung',
		mood: 'Hypnotic',
		tags: ['Thailand', 'Isan', 'molam', 'DJ'],
		descriptor: "Japanese duo Soi48's championed Thai molam & luk thung — Isan dancefloor heat.",
		tracks: [
			['Dao Bandon', 'Molam · Luk Thung sides'],
			['Angkana Khunchai', 'Molam · Luk Thung sides'],
			['Phet Phin Thong', 'Molam · Luk Thung sides'],
			['Waiphod Phetsuphane', 'Molam · Luk Thung sides'],
			['Thonghuad Faited', 'Molam · Luk Thung sides']
		]
	},
	{
		slug: 'madrotter',
		name: 'Madrotter Treasure Hunt',
		url: 'http://madrotter-treasure-hunt.blogspot.com/',
		genre: 'Indonesian / Dangdut / Kroncong',
		mood: 'Tropical',
		tags: ['Indonesia', 'dangdut', 'gamelan', 'vinyl'],
		descriptor: 'Rare Indonesian vinyl & cassettes — dangdut, kroncong, jaipong, gamelan, pop (1950s–2000s).',
		tracks: [
			['Orkes Lie Tan', 'Gambang Keromong'],
			['Neno Warisman', 'Asmaraku'],
			['Orkes Melayu Berlian', 'Patah Hati'],
			['H. Dariyah & Cahaya Muda Group', 'Barlen Sinyur'],
			['H. Dariyah & Rineka Gaya Group', 'Sono Deui'],
			['Orkes Melayu Kelana', 'Hany Vol. 2']
		]
	},
	{
		slug: 'phyuniwarpyar',
		name: 'Phyu Ni War Pyar (Burmese Music)',
		url: 'https://phyuniwarpyarmusic.blogspot.com/',
		genre: 'Burmese Traditional / Classical',
		mood: 'Theatrical',
		tags: ['Myanmar', 'folk', 'drama', 'cassette'],
		descriptor: 'Burmese classical songs, cassette dramas and theatrical performances (1980s–2000s).',
		tracks: [
			['Hsintharthumyein', 'Best Karaoke Songs'],
			['Nunu Sein', 'Comedy Performance'],
			['Wai Myin', 'Nway Htoon Kae Thi'],
			['Ko Metta Lo Khaw Par Diss', 'Drama Story']
		]
	},
	{
		slug: 'oriental-traditional',
		name: 'Oriental Traditional Music',
		url: 'https://oriental-traditional-music.blogspot.com/',
		genre: 'Hindustani Classical',
		mood: 'Meditative',
		tags: ['India', 'raga', 'Jaipur-Atrauli', 'AIR'],
		descriptor: 'North Indian (Hindustani) classical — Jaipur-Atrauli gharana, from AIR tapes & LPs (1930s–90s).',
		tracks: [
			['Padmavati Shaligram', 'All India Radio Release'],
			['Azam Bai', 'All India Radio Release'],
			['Nivruttibua Sarnaik', 'AIR Recordings'],
			['Mallikarjun Mansur', 'Echoes of a Soulful Voice'],
			['Mallikarjun Mansur', 'Morning and Evening Ragas'],
			['Mogubai Kurdikar & Sardarbai Karadgekar', 'Raga Basanti Kedar']
		]
	},
	{
		slug: 'moroccantapestash',
		name: 'Moroccan Tape Stash',
		url: 'https://moroccantapestash.blogspot.com/',
		genre: 'Moroccan Folk / Gnawa / Chaabi',
		mood: 'Hypnotic',
		tags: ['Morocco', 'Gnawa', 'Amazigh', 'cassette'],
		descriptor: 'Music from Moroccan cassettes — Gnawa, Chaabi, Amarg/Soussi and regional folk (1980s–2000s).',
		tracks: [
			['Paco Abderrahmane', "T'hayyer A Moul al Hal"],
			['Fatima Tabaamrant', 'Nekkay Igan Anafal'],
			['Toudadine', 'Songs of Lhoucine Amentag (Tagroupit-style)']
		]
	},
	{
		slug: 'foundtapes',
		name: 'Found Tapes (K7 Maghreb)',
		url: 'https://foundtapes.blogspot.com/',
		genre: 'Raï / Chaâbi / Maghrebi',
		mood: 'Vintage',
		tags: ['Algeria', 'Morocco', 'raï', 'cassette'],
		descriptor: 'Vintage Maghrebi cassette music — raï, chaâbi and North African folk (1980s–90s).',
		tracks: [
			['Nouredine Ben Ghali', 'Yasshab El Ghourba'],
			['Samir El Eulmi', 'Samir El Eulmi'],
			['Cheikha Djenia', 'Vialaria'],
			['Cheb Khaled', 'Mondial 86'],
			['Farat et Khalass', 'Farat et Khalass'],
			['Chaba Minoucha', 'Moul Chech']
		]
	},
	{
		slug: 'bodegapop',
		name: 'Bodega Pop',
		url: 'https://bodegapop.blogspot.com/',
		genre: 'Global Pop / Oddities',
		mood: 'Eclectic',
		tags: ['global', 'compilation', 'WFMU', 'pop'],
		descriptor: "Gary Sullivan's globe-spanning pop oddities — comps from Cambodia to Albania (WFMU).",
		tracks: [
			['Various Artists', 'Rare Cambodian Trax 1960s–70s'],
			['Various Artists', 'Yellow Music: Shanghai Pop 1930s–40s'],
			['Naseebo Lal', "Pakistan's Last Diva"],
			['Various Artists', 'Punk Islam'],
			['Various Artists', 'Albanian Sisters Swim to Freedom'],
			['Various Artists', 'Bollywood Freak Out']
		]
	},
	{
		slug: 'neosamzpoke',
		name: 'Neosamzpoke',
		url: 'https://neosamzpoke.blogspot.com/',
		genre: 'Japanese Underground / Experimental',
		mood: 'Avant',
		tags: ['Japan', 'private press', 'post-punk', 'noise'],
		descriptor: 'Obscure Japanese private-press, post-punk, noise and experimental records (1960s–80s).',
		tracks: [
			['Sunaoira', 'Are You Guys Still Alive? I Am, Sorta.'],
			['John Duncan', 'Pleasure Escape'],
			['Pearl Sisters', 'Nima / Wakareta Ano Hito'],
			['Sally May', 'Hibotan Iwa To / Kinpatsu Enka'],
			['Akevonoiz', 'Untitled'],
			['Toshiaki Tsushima', 'Battles Without Honor and Humanity (OST)']
		]
	},
	{
		slug: '1000flights',
		name: '1000 Flights',
		url: 'http://1000flights.blogspot.com/',
		genre: 'Underground / Punk / Experimental',
		mood: 'Raw',
		tags: ['DIY', 'punk', 'cassette', 'Europe'],
		descriptor: 'Obscure self-released punk, anarchopunk & experimental tapes (1980s–2000s).',
		tracks: [
			['MANIA', 'Free Zine'],
			['Reaccion', 'Demonstration Tape'],
			['Sida & Destrucción', 'Split 7"'],
			['Piume e Sangue', 'Procedure'],
			['Sadomundo', 'Standard of Pain'],
			['Various Artists', 'Der Verlag 2']
		]
	},
	{
		slug: 'nostalgie-de-la-boue',
		name: 'Nostalgie de la Boue',
		url: 'https://nostalgie-de-la-boue.blogspot.com/',
		genre: 'Experimental / Avant-garde',
		mood: 'Abstract',
		tags: ['cassette', 'noise', 'archival', 'experimental'],
		descriptor: 'Unreleased & archival experimental and electronic cassette music.',
		tracks: [
			['Concrete Colored Paint', 'And Now Here'],
			['Daniel Gianfranceschi', 'De Fine Temporum'],
			['Sol Dièse & Phil Gaz', 'Histoires Extraordinaires'],
			['Agog', 'Putting Legs On A Snake'],
			['factor X', 'Music Of Sound'],
			['Martine Chine', 'Postulate']
		]
	},
	{
		slug: 'tapeattack',
		name: 'Tape Attack',
		url: 'http://tapeattack.blogspot.com/',
		genre: 'Cassette Underground / Industrial',
		mood: 'Lo-fi',
		tags: ['Germany', 'industrial', 'new wave', 'cassette'],
		descriptor: 'The 80s–90s European cassette underground — punk, industrial, electro and new wave tapes.',
		tracks: [
			['Blinddarm', 'Der Mensch Auf Dem Weg In Die Steckdose'],
			['Wotan Watuszi', 'Mussygck'],
			['DAF', 'In Berlin Live 15.12.80'],
			['Rouska', '04/84'],
			['Chazev', 'Katatonia'],
			['Chazev', 'Sixvoic']
		]
	},
	{
		slug: 'disorder',
		name: 'Disorder (Are You Experienced?)',
		url: 'https://disorderareyouexperienced.blogspot.com/',
		genre: 'Punk / Post-punk',
		mood: 'Frenetic',
		tags: ['punk', '1970s', '1980s', 'vinyl'],
		descriptor: 'A history of punk — obscure & influential punk and post-punk 45s and LPs (late 70s–80s).',
		tracks: [
			['Gaznevada', 'Gaznevada'],
			['Trancefusion', 'Incredible But True!'],
			['Koro', 'Koro EP'],
			['The Strand', 'Seconds Waiting'],
			['The Zits', 'Back In BlackHead'],
			['Various Artists', 'Bloodstains Across Virginia']
		]
	},
	{
		slug: 'dieordiy2',
		name: 'Die or DIY?',
		url: 'https://dieordiy2.blogspot.com/',
		genre: 'Underground Electronic / Industrial',
		mood: 'Cerebral',
		tags: ['UK', 'industrial', 'IDM', 'ambient'],
		descriptor: 'UK/European underground electronic, industrial, IDM and ambient (1970s–90s).',
		tracks: [
			['Boards Of Canada', 'Old Tunes Vol. 2'],
			['Boards Of Canada', 'A Few Old Tunes'],
			['Various Artists', 'The Philosophy Of Sound And Machine'],
			['Maurice Joshua', 'This Is Acid (a New Dance Craze)']
		]
	},
	{
		slug: 'norecordshopsleft',
		name: 'No Record Shops Left',
		url: 'https://norecordshopsleft.blogspot.com/',
		genre: 'Indie Pop / Alternative',
		mood: 'Lo-fi',
		tags: ['UK', 'indie', '1980s', '1990s'],
		descriptor: '1980s–90s indie pop, post-punk and alternative from UK/US/AU independent labels.',
		tracks: [
			['Die Warzau', 'Funkopolis'],
			['My Life With The Thrill Kill Kult', 'Confessions Of A Knife'],
			['The KLF', 'Waiting For The Rights Of Mu'],
			['2K', '*K The Millennium'],
			['Space', 'Space']
		]
	},
	{
		slug: 'public-embarrassment-blues',
		name: 'Public Embarrassment Blues',
		url: 'http://public-embarrassment-blues.blogspot.com/',
		genre: 'Post-punk / Minimal Synth',
		mood: 'Bleak',
		tags: ['post-punk', 'minimal synth', 'obscure'],
		descriptor: 'A long-running shareblog of obscure post-punk, minimal synth and outsider rock.',
		tracks: [['The Mothmen', 'Pay Attention!']]
	}
];

// ── apply ──────────────────────────────────────────────────────────────────
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Ensure the blog-source columns exist even if the app hasn't booted on the new
// migration yet, and record the migration so the app won't try to re-apply it.
const cols = (db.prepare('PRAGMA table_info(tracks)').all()).map((c) => String(c.name));
if (!cols.includes('source')) db.exec("ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");
if (!cols.includes('source_url')) db.exec('ALTER TABLE tracks ADD COLUMN source_url TEXT');
db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
if (!db.prepare("SELECT 1 FROM _migrations WHERE id = '005_blog_source'").get()) {
	db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run('005_blog_source', new Date().toISOString());
}

const now = new Date().toISOString();
const sortName = (n) => n.replace(/^(the|a|an)\s+/i, '');

db.exec('BEGIN');
try {
	// wipe any previous blogroll (cascades clean up playlist_tracks + blog tracks)
	db.exec("DELETE FROM playlists WHERE source = 'blogroll'");
	db.exec("DELETE FROM tracks WHERE source = 'blog'");
	db.exec("DELETE FROM albums WHERE source = 'blog'");
	db.exec("DELETE FROM artists WHERE lower(name) NOT IN (SELECT lower(album_artist) FROM albums)");

	const insArtist = db.prepare('INSERT OR IGNORE INTO artists (name, sort_name) VALUES (?, ?)');
	const insAlbum = db.prepare(
		`INSERT INTO albums (title, album_artist, year, source, added_at, genre, mood, tags, descriptor, analyzed_at)
		 VALUES (?, ?, NULL, 'blog', ?, ?, ?, ?, ?, ?)`
	);
	const insTrack = db.prepare(
		`INSERT INTO tracks (album_id, artist, title, track_no, duration_ms, codec, sample_rate, path, source, source_url, added_at)
		 VALUES (?, ?, ?, ?, 0, '', 0, ?, 'blog', ?, ?)`
	);
	const insPlaylist = db.prepare(
		'INSERT INTO playlists (name, persistent_id, source, created_at) VALUES (?, ?, ?, ?)'
	);
	const insItem = db.prepare('INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)');

	const playlistTrackIds = [];
	let trackTotal = 0;

	for (const blog of BLOGS) {
		insArtist.run(blog.name, sortName(blog.name));
		const albumId = Number(
			insAlbum.run(blog.name, blog.name, now, blog.genre, blog.mood, JSON.stringify(blog.tags), blog.descriptor, now)
				.lastInsertRowid
		);
		blog.tracks.forEach(([artist, title], i) => {
			const id = Number(
				insTrack.run(albumId, artist, title, i + 1, `blog:${blog.slug}:${i + 1}`, blog.url, now).lastInsertRowid
			);
			playlistTrackIds.push(id);
			trackTotal++;
		});
	}

	const playlistId = Number(insPlaylist.run(PLAYLIST_NAME, PLAYLIST_PID, 'blogroll', now).lastInsertRowid);
	playlistTrackIds.forEach((id, pos) => insItem.run(playlistId, pos, id));

	db.exec('COMMIT');
	console.log(`✓ seeded ${BLOGS.length} blog crates, ${trackTotal} tracks → playlist "${PLAYLIST_NAME}" (#${playlistId})`);
} catch (e) {
	db.exec('ROLLBACK');
	console.error('✗ seed failed:', e);
	process.exitCode = 1;
}

// Rebuild the FTS index (mirror src/lib/server/search.ts) so the new crates are
// searchable. Content-less FTS5 table; no-op if this build lacks FTS5.
try {
	const hasFts = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'search_fts'").get();
	if (hasFts) {
		db.exec('DELETE FROM search_fts');
		const ins = db.prepare('INSERT INTO search_fts (kind, ref_id, text) VALUES (?, ?, ?)');
		db.exec('BEGIN');
		for (const a of db.prepare('SELECT id, name FROM artists').all()) ins.run('artist', Number(a.id), String(a.name));
		for (const al of db.prepare('SELECT id, title, album_artist FROM albums').all())
			ins.run('album', Number(al.id), `${al.title} ${al.album_artist}`);
		for (const t of db.prepare('SELECT id, title, artist FROM tracks').all())
			ins.run('track', Number(t.id), `${t.title} ${t.artist}`);
		db.exec('COMMIT');
		console.log('✓ rebuilt search index');
	}
} catch (e) {
	console.warn('· search index rebuild skipped:', e?.message ?? e);
}

db.close();
