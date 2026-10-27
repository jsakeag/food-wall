// Binary-insertion state over one person's bucket, ordered best first (higher position = better).
// The new recipe will be inserted at an index in [lo, hi]; when lo === hi we're done.
export type Search = { lo: number; hi: number };

export function startSearch(list: unknown[]): Search {
	return { lo: 0, hi: list.length };
}

export function midpoint({ lo, hi }: Search) {
	return Math.floor((lo + hi) / 2);
}

export function isDone({ lo, hi }: Search) {
	return lo >= hi;
}

export function answer(search: Search, newIsBetter: boolean): Search {
	const mid = midpoint(search);
	return newIsBetter ? { lo: search.lo, hi: mid } : { lo: mid + 1, hi: search.hi };
}

// "Too close to call": settle right below the recipe being compared.
export function tie(search: Search): Search {
	const index = midpoint(search) + 1;
	return { lo: index, hi: index };
}

// Position for inserting at `index` in a best-first list (higher position = better).
export function positionAt(list: { position: number }[], index: number) {
	const above = list[index - 1]?.position;
	const below = list[index]?.position;
	if (above !== undefined && below !== undefined) return (above + below) / 2;
	if (above !== undefined) return above - 1;
	if (below !== undefined) return below + 1;
	return 0;
}
