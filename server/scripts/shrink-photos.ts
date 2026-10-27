// One-off: shrink photos uploaded before the server started resizing them.
//   node --env-file=.env scripts/shrink-photos.ts
// Safe to re-run: photos already under 500 KB are left alone.
import { statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { shrinkPhoto } from "../src/photos.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL must be set");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const { rows } = await pool.query("select id, photo from recipes where photo is not null");

let before = 0;
let after = 0;
let shrunk = 0;
for (const { id, photo } of rows) {
	const file = path.join(UPLOAD_DIR, photo);
	let size: number;
	try {
		size = statSync(file).size;
	} catch {
		console.warn(`  missing file for recipe ${id}: ${photo}`);
		continue;
	}
	before += size;
	if (size < 500 * 1024) {
		after += size;
		continue;
	}
	// Only remove the original once the recipe points at the new file.
	const smaller = await shrinkPhoto(file, { deleteOriginal: false });
	if (smaller !== photo) {
		await pool.query("update recipes set photo = $2 where id = $1", [id, smaller]);
		await unlink(file);
		shrunk++;
	}
	after += statSync(path.join(UPLOAD_DIR, smaller)).size;
}

await pool.end();
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
console.log(`Shrunk ${shrunk} photos: ${mb(before)} MB -> ${mb(after)} MB`);
