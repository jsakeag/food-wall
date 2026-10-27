import type { Recipe } from "./api";

// Words that don't tell dishes apart.
const FILLER = new Set(["a", "an", "and", "the", "with", "w", "of", "in", "on", "for", "to", "n", "ft", "my", "some", "from", "recipe"]);
// How alike two names must be to ask "same as this?" (0 = nothing shared, 1 = same words).
const THRESHOLD = 0.45;

// The words that identify a dish: lowercase, without dates like "10/9", counts, emoji or filler,
// and with a plural "s" dropped ("green beans" matches "green bean").
function dishWords(title: string) {
	const words = title
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
		.map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
	return [...new Set(words)];
}

// Up to three recipes (one per group) whose names are close to `title`, closest first.
// Words that show up in lots of names ("chicken", "salad") count for less than rare ones.
export function likelyDupes(title: string, recipes: Recipe[]): Recipe[] {
	const mine = dishWords(title);
	const theirs = recipes.map((r) => dishWords(r.title));
	const seenIn = new Map<string, number>();
	for (const words of [mine, ...theirs]) for (const w of words) seenIn.set(w, (seenIn.get(w) ?? 0) + 1);
	const weight = (w: string) => Math.log(1 + (theirs.length + 1) / (seenIn.get(w) ?? 1));
	const total = (words: string[]) => words.reduce((sum, w) => sum + weight(w), 0);

	const best = new Map<string, { recipe: Recipe; similarity: number }>();
	recipes.forEach((recipe, i) => {
		const shared = total(mine.filter((w) => theirs[i].includes(w)));
		const both = total(mine) + total(theirs[i]);
		const similarity = both ? (2 * shared) / both : 0;
		const current = best.get(recipe.group_id);
		if (similarity >= THRESHOLD && (!current || similarity > current.similarity)) {
			best.set(recipe.group_id, { recipe, similarity });
		}
	});
	return [...best.values()]
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, 3)
		.map((m) => m.recipe);
}

export type Group = {
	// The best-rated cook of the dish (the newest if none is rated), shown on the card.
	key: Recipe;
	// Every other cook, newest first.
	others: Recipe[];
	// When it was last cooked, for the recent tab.
	latest: string;
};

// Gathers dupes into one group per dish.
export function groupDupes(recipes: Recipe[]): Group[] {
	const byGroup = new Map<string, Recipe[]>();
	for (const recipe of recipes) {
		if (!byGroup.has(recipe.group_id)) byGroup.set(recipe.group_id, []);
		byGroup.get(recipe.group_id)!.push(recipe);
	}
	return [...byGroup.values()].map((cooks) => {
		const newestFirst = [...cooks].sort((a, b) => b.created_at.localeCompare(a.created_at));
		const key = newestFirst.reduce((top, r) => ((r.score ?? -1) > (top.score ?? -1) ? r : top));
		return { key, others: newestFirst.filter((r) => r !== key), latest: newestFirst[0].created_at };
	});
}
