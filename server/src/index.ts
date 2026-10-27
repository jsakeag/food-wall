import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import pg from "pg";
import { shrinkPhoto } from "./photos.ts";

const { DATABASE_URL, API_KEY } = process.env;
if (!DATABASE_URL || !API_KEY) {
	throw new Error("DATABASE_URL and API_KEY must be set (see .env.example)");
}
const PEOPLE = (process.env.PEOPLE ?? "")
	.split(",")
	.map((name) => name.trim())
	.filter(Boolean);
if (PEOPLE.length === 0) {
	throw new Error("PEOPLE must list who uses the app, e.g. PEOPLE=Alex,Sam");
}
const PORT = Number(process.env.PORT ?? 3000);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

// Score range for each bucket; rank within the bucket spreads recipes across it.
const BUCKET_RANGES: Record<string, [number, number]> = {
	loved: [7, 10],
	fine: [4, 7],
	disliked: [0, 4],
};

const pool = new pg.Pool({ connectionString: DATABASE_URL });
await pool.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));

const upload = multer({
	storage: multer.diskStorage({
		destination: UPLOAD_DIR,
		filename: (_req, file, cb) => {
			const ext = path.extname(file.originalname).slice(1).toLowerCase() || "jpg";
			cb(null, `${randomUUID()}.${ext.replace(/[^a-z0-9]/g, "")}`);
		},
	}),
	limits: { fileSize: 10 * 1024 * 1024 },
	// Some clients send an empty/generic type, so also accept image file extensions.
	fileFilter: (_req, file, cb) => {
		const isImage =
			file.mimetype.startsWith("image/") ||
			/\.(jpe?g|png|heic|heif|webp)$/i.test(file.originalname);
		if (isImage) cb(null, true);
		else cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "photo"));
	},
});

const app = express();

// In production the web app and API share a domain; this lets the local Expo web dev server
// (a different port) call the API too. The API key still guards everything.
app.use((req, res, next) => {
	res.set({
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "x-api-key, content-type",
		"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
	});
	if (req.method === "OPTIONS") {
		res.status(204).end();
		return;
	}
	next();
});

app.get("/health", (_req, res) => {
	res.json({ ok: true });
});

// Photo filenames are random UUIDs, so they're served without the key
// (the app's <Image> doesn't need custom headers that way).
app.use("/photos", express.static(UPLOAD_DIR, { maxAge: "30d", immutable: true }));

function requireKey(req: Request, res: Response, next: NextFunction) {
	const given = Buffer.from(req.get("x-api-key") ?? "");
	const expected = Buffer.from(API_KEY!);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		res.status(401).json({ error: "Invalid API key" });
		return;
	}
	next();
}
app.use(requireKey);

app.get("/people", (_req, res) => {
	res.json({ people: PEOPLE });
});

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

function ratingError(person: unknown, bucket: unknown, position: number) {
	if (typeof person !== "string" || !PEOPLE.includes(person)) return "Unknown person";
	if (typeof bucket !== "string" || !(bucket in BUCKET_RANGES)) return "Invalid bucket";
	if (!Number.isFinite(position)) return "Invalid position";
	return null;
}

// The photo's taken-at time sent by the app, if it's a real date that isn't in the future.
function madeAt(value: unknown) {
	const date = new Date(typeof value === "string" ? value : NaN);
	return Number.isNaN(date.getTime()) || date.getTime() > Date.now() ? null : date;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

app.get("/recipes", async (_req, res) => {
	const [{ rows: recipes }, { rows: ratings }] = await Promise.all([
		pool.query("select * from recipes order by created_at desc"),
		pool.query(`
			select recipe_id, person, bucket, position,
				row_number() over w as rank,
				count(*) over (partition by person, bucket) as bucket_size
			from ratings
			window w as (partition by person, bucket order by position desc)
		`),
	]);

	const byRecipe = new Map<string, { person: string; bucket: string; position: number; score: number }[]>();
	for (const { recipe_id, person, bucket, position, rank, bucket_size } of ratings) {
		const [lo, hi] = BUCKET_RANGES[bucket];
		const n = Number(bucket_size);
		// Best in bucket gets the top of the range; each step down loses (hi - lo) / n.
		const score = lo + ((hi - lo) * (n - Number(rank) + 1)) / n;
		if (!byRecipe.has(recipe_id)) byRecipe.set(recipe_id, []);
		byRecipe.get(recipe_id)!.push({ person, bucket, position, score });
	}

	res.json({
		recipes: recipes.map((recipe) => {
			const recipeRatings = (byRecipe.get(recipe.id) ?? []).sort(
				(a, b) => PEOPLE.indexOf(a.person) - PEOPLE.indexOf(b.person),
			);
			const average = recipeRatings.length
				? recipeRatings.reduce((sum, r) => sum + r.score, 0) / recipeRatings.length
				: null;
			return {
				...recipe,
				score: average === null ? null : round1(average),
				ratings: recipeRatings.map((r) => ({ ...r, score: round1(r.score) })),
			};
		}),
	});
});

// Logging a recipe also records the logger's rating of it.
app.post("/recipes", upload.single("photo"), async (req, res) => {
	const { person, title, source_url, note, bucket } = req.body ?? {};
	const position = Number(req.body?.position);
	const error = ratingError(person, bucket, position) ?? (!title?.trim() ? "Title is required" : null);
	if (error) {
		if (req.file) await unlink(req.file.path).catch(() => {});
		res.status(400).json({ error });
		return;
	}

	const photo = req.file ? await shrinkPhoto(req.file.path) : null;
	const client = await pool.connect();
	try {
		await client.query("begin");
		const { rows } = await client.query(
			`insert into recipes (created_by, title, source_url, note, photo, created_at)
			values ($1, $2, $3, $4, $5, coalesce($6, now()))
			returning *`,
			[person, title.trim(), source_url?.trim() || null, note?.trim() || null, photo, madeAt(req.body.made_at)],
		);
		await client.query(
			"insert into ratings (recipe_id, person, bucket, position) values ($1, $2, $3, $4)",
			[rows[0].id, person, bucket, position],
		);
		await client.query("commit");
		res.status(201).json({ recipe: rows[0] });
	} catch (err) {
		await client.query("rollback");
		if (photo) await unlink(path.join(UPLOAD_DIR, photo)).catch(() => {});
		throw err;
	} finally {
		client.release();
	}
});

// Edit name, link, notes, and optionally replace the photo.
app.patch("/recipes/:id", upload.single("photo"), async (req, res) => {
	const discardUpload = () => (req.file ? unlink(req.file.path).catch(() => {}) : undefined);
	const id = String(req.params.id);
	const { title, source_url, note } = req.body ?? {};
	if (!isUuid(id)) {
		await discardUpload();
		res.status(404).json({ error: "Not found" });
		return;
	}
	if (!title?.trim()) {
		await discardUpload();
		res.status(400).json({ error: "Title is required" });
		return;
	}

	const { rows: before } = await pool.query("select photo from recipes where id = $1", [id]);
	if (before.length === 0) {
		await discardUpload();
		res.status(404).json({ error: "Not found" });
		return;
	}
	const photo = req.file ? await shrinkPhoto(req.file.path) : null;
	const { rows } = await pool.query(
		`update recipes set title = $2, source_url = $3, note = $4, photo = coalesce($5, photo),
			created_at = coalesce($6, created_at)
		where id = $1
		returning *`,
		[id, title.trim(), source_url?.trim() || null, note?.trim() || null, photo, photo ? madeAt(req.body.made_at) : null],
	);
	if (req.file && before[0].photo) {
		await unlink(path.join(UPLOAD_DIR, before[0].photo)).catch(() => {});
	}
	res.json({ recipe: rows[0] });
});

// Add (or redo) one person's rating of an existing recipe.
app.put("/recipes/:id/ratings/:person", express.json(), async (req, res) => {
	const { id, person } = req.params;
	const position = Number(req.body?.position);
	const error = ratingError(person, req.body?.bucket, position);
	if (error) {
		res.status(400).json({ error });
		return;
	}
	if (!isUuid(id)) {
		res.status(404).json({ error: "Not found" });
		return;
	}
	try {
		await pool.query(
			`insert into ratings (recipe_id, person, bucket, position) values ($1, $2, $3, $4)
			on conflict (recipe_id, person)
			do update set bucket = excluded.bucket, position = excluded.position, created_at = now()`,
			[id, person, req.body.bucket, position],
		);
	} catch (err) {
		if ((err as { code?: string }).code === "23503") {
			res.status(404).json({ error: "Not found" });
			return;
		}
		throw err;
	}
	res.status(204).end();
});

app.delete("/recipes/:id", async (req, res) => {
	if (!isUuid(req.params.id)) {
		res.status(404).json({ error: "Not found" });
		return;
	}
	const { rows } = await pool.query("delete from recipes where id = $1 returning photo", [
		req.params.id,
	]);
	if (rows.length === 0) {
		res.status(404).json({ error: "Not found" });
		return;
	}
	if (rows[0].photo) {
		await unlink(path.join(UPLOAD_DIR, rows[0].photo)).catch(() => {});
	}
	res.status(204).end();
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
	if (err instanceof multer.MulterError) {
		const message = err.code === "LIMIT_UNEXPECTED_FILE" ? "Photo must be an image" : err.message;
		res.status(400).json({ error: message });
		return;
	}
	console.error(err);
	res.status(500).json({ error: "Something went wrong" });
});

app.listen(PORT, () => {
	console.log(`mock-beli server on :${PORT} for ${PEOPLE.join(" & ")}`);
});
