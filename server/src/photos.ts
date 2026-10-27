import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Keep memory low on a small Droplet: one image at a time, no decoded-image cache.
sharp.concurrency(1);
sharp.cache(false);

const MAX_SIDE = 1200;

// Turns an uploaded original (often a ~3 MB iPhone photo) into a ~200 KB JPEG next to it and
// returns the new filename, deleting the original unless told not to. If the image can't be
// decoded (e.g. an unusual format), the original is kept and its own filename returned.
export async function shrinkPhoto(filePath: string, { deleteOriginal = true } = {}): Promise<string> {
	const output = path.join(path.dirname(filePath), `${randomUUID()}.jpg`);
	try {
		await sharp(filePath)
			.rotate() // apply the phone's EXIF orientation before it's stripped
			.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
			.jpeg({ quality: 80, mozjpeg: true })
			.toFile(output);
	} catch (err) {
		console.warn(`Couldn't shrink ${path.basename(filePath)}, keeping original:`, (err as Error).message);
		await unlink(output).catch(() => {});
		return path.basename(filePath);
	}
	if (deleteOriginal) await unlink(filePath).catch(() => {});
	return path.basename(output);
}
