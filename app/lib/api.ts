import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { isWeb } from "./platform";

// The web app is served next to the API (under /api) on the same domain.
const API_URL = process.env.EXPO_PUBLIC_API_URL || (isWeb ? "/api" : "");
// The iPhone app can have the key built in. The web app never does (anyone could read it from
// the page), so it asks for it once as a passcode and keeps it in storage — see setApiKey.
let apiKey = isWeb ? "" : (process.env.EXPO_PUBLIC_API_KEY ?? "");

export const hasApiKey = () => apiKey !== "";
export function setApiKey(key: string) {
	apiKey = key;
}

// expo/fetch uploads expo-file-system Files on the phone; browsers use their own fetch and Blobs.
const fetch = isWeb ? globalThis.fetch.bind(globalThis) : (expoFetch as unknown as typeof globalThis.fetch);

async function appendPhoto(form: FormData, uri: string) {
	if (isWeb) {
		const blob = await (await fetch(uri)).blob();
		const ext = blob.type.split("/")[1] || "jpg";
		form.append("photo", blob, `photo.${ext}`);
	} else {
		form.append("photo", new File(uri) as unknown as Blob);
	}
}

export type Bucket = "loved" | "fine" | "disliked";

export type Rating = {
	person: string;
	bucket: Bucket;
	position: number;
	score: number;
};

export type Recipe = {
	id: string;
	created_at: string;
	created_by: string;
	title: string;
	source_url: string | null;
	note: string | null;
	photo: string | null;
	// The photo's upright size (null for old photos not measured yet).
	photo_width: number | null;
	photo_height: number | null;
	// Shared by recipes that are the same dish cooked again (see lib/dupes).
	group_id: string;
	// Average of everyone's ratings.
	score: number | null;
	ratings: Rating[];
};

export type NewRecipe = {
	person: string;
	title: string;
	source_url: string;
	note: string;
	bucket: Bucket;
	position: number;
	photoUri: string | null;
	// When the photo was taken (ISO), which becomes the recipe's date; otherwise it's now.
	madeAt: string | null;
	// The recipe this is a dupe of, if any.
	dupeOf: string | null;
};

async function request(path: string, init?: RequestInit) {
	if (!API_URL) throw new Error("EXPO_PUBLIC_API_URL is not set (see app/.env.example)");
	const res = await fetch(API_URL + path, {
		...init,
		headers: { "x-api-key": apiKey, ...init?.headers },
	});
	if (!res.ok) {
		let message = `Request failed (${res.status})`;
		try {
			message = (await res.json()).error ?? message;
		} catch {}
		throw new Error(message);
	}
	return res;
}

export function photoUrl(photo: string) {
	return `${API_URL}/photos/${photo}`;
}

// Width ÷ height to show a recipe's photo at: its real shape, kept within portrait 3:5 and
// landscape 5:3 so no card gets absurdly tall or thin. Square when there's no size.
export function photoAspect(recipe: Recipe) {
	if (!recipe.photo || !recipe.photo_width || !recipe.photo_height) return 1;
	return Math.min(5 / 3, Math.max(3 / 5, recipe.photo_width / recipe.photo_height));
}

export async function getPeople(): Promise<string[]> {
	return (await (await request("/people")).json()).people;
}

export async function getRecipes(): Promise<Recipe[]> {
	return (await (await request("/recipes")).json()).recipes;
}

export async function createRecipe(recipe: NewRecipe) {
	const form = new FormData();
	form.append("person", recipe.person);
	form.append("title", recipe.title);
	form.append("source_url", recipe.source_url);
	form.append("note", recipe.note);
	form.append("bucket", recipe.bucket);
	form.append("position", String(recipe.position));
	if (recipe.photoUri) await appendPhoto(form, recipe.photoUri);
	if (recipe.madeAt) form.append("made_at", recipe.madeAt);
	if (recipe.dupeOf) form.append("dupe_of", recipe.dupeOf);
	await request("/recipes", { method: "POST", body: form });
}

export async function updateRecipe(
	id: string,
	changes: { title: string; source_url: string; note: string; photoUri: string | null; madeAt: string | null },
) {
	const form = new FormData();
	form.append("title", changes.title);
	form.append("source_url", changes.source_url);
	form.append("note", changes.note);
	// Only a newly picked (local) photo is uploaded; otherwise the saved one is kept.
	if (changes.photoUri) await appendPhoto(form, changes.photoUri);
	// A new photo's date moves the recipe to when that photo was taken.
	if (changes.madeAt) form.append("made_at", changes.madeAt);
	await request(`/recipes/${id}`, { method: "PATCH", body: form });
}

export async function rateRecipe(id: string, person: string, bucket: Bucket, position: number) {
	await request(`/recipes/${id}/ratings/${encodeURIComponent(person)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ bucket, position }),
	});
}

// Groups `id` (and anything already grouped with it) with `dupeOf` as the same dish.
export async function markDupe(id: string, dupeOf: string) {
	await request(`/recipes/${id}/group`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ dupe_of: dupeOf }),
	});
}

export async function unlinkDupe(id: string) {
	await request(`/recipes/${id}/group`, { method: "DELETE" });
}

export function ratingBy(recipe: Recipe, person: string) {
	return recipe.ratings.find((r) => r.person === person);
}

export async function deleteRecipe(id: string) {
	await request(`/recipes/${id}`, { method: "DELETE" });
}
