// One-off import of the old food-gallery Supabase backup into recipes.
// Each post becomes an unrated recipe (same id, date and photo); both people rate them in the app.
//
//   node --env-file=.env scripts/import-supabase.ts <db_cluster.backup> <storage images dir> "jsakeag=Keagan,mmli1=Michelle"
//
// Safe to re-run: posts already imported (same id) are skipped.
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const [backupPath, imagesDir, mappingArg] = process.argv.slice(2);
if (!backupPath || !imagesDir || !mappingArg) {
	console.error('usage: import-supabase.ts <backup> <images dir> "supabaseName=Person,..."');
	process.exit(1);
}
const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL must be set");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

const nameMap = new Map(
	mappingArg.split(",").map((pair) => pair.split("=").map((s) => s.trim()) as [string, string]),
);

// Rows of a `COPY schema.table (cols) FROM stdin;` block in a pg_dump text file.
function copyRows(dump: string, table: string): Record<string, string | null>[] {
	const header = new RegExp(`^COPY ${table.replace(".", "\\.")} \\(([^)]*)\\) FROM stdin;$`, "m");
	const match = header.exec(dump);
	if (!match) throw new Error(`No data for ${table} in backup`);
	const columns = match[1].split(",").map((c) => c.trim().replace(/"/g, ""));
	const body = dump.slice(match.index + match[0].length + 1);
	const rows = [];
	for (const line of body.split("\n")) {
		if (line === "\\.") break;
		const values = line.split("\t").map((v) =>
			v === "\\N"
				? null
				: v.replace(/\\(.)/g, (_, c) => ({ t: "\t", n: "\n", r: "\r", "\\": "\\" })[c as string] ?? c),
		);
		rows.push(Object.fromEntries(columns.map((c, i) => [c, values[i]])));
	}
	return rows;
}

const dump = readFileSync(backupPath, "utf8");
const profiles = new Map(copyRows(dump, "public.profiles").map((p) => [p.id, p.display_name]));
const posts = copyRows(dump, "public.posts");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
await pool.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));

let imported = 0;
let skipped = 0;
for (const post of posts) {
	const supabaseName = profiles.get(post.post_by!);
	const person = supabaseName && nameMap.get(supabaseName);
	if (!person) throw new Error(`No mapping for poster ${supabaseName ?? post.post_by} (post ${post.id})`);

	const { rowCount } = await pool.query("select 1 from recipes where id = $1", [post.id]);
	if (rowCount) {
		skipped++;
		continue;
	}

	let photo: string | null = null;
	const source = path.join(imagesDir, post.post_by!, post.id!, post.name!);
	if (existsSync(source)) {
		const ext = path.extname(post.name!).slice(1).toLowerCase() || "jpg";
		photo = `${randomUUID()}.${ext}`;
		copyFileSync(source, path.join(UPLOAD_DIR, photo));
	} else {
		console.warn(`  no photo found for "${post.description}" (${source})`);
	}

	await pool.query(
		`insert into recipes (id, created_at, created_by, title, photo)
		values ($1, $2, $3, $4, $5)`,
		[post.id, post.created_at, person, post.description?.trim() || "untitled", photo],
	);
	imported++;
}

await pool.end();
console.log(`Imported ${imported} recipes (${skipped} already there) into ${UPLOAD_DIR}`);
