import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Image,
	Modal,
	PanResponder,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { photoUrl, ratingBy, saveOrder, type Bucket, type Recipe } from "../lib/api";
import { isWeb, notify, useSheetTopInset } from "../lib/platform";
import { BUCKETS, colors, fonts, radius } from "../lib/theme";
import ScoreBadge from "./ScoreBadge";

type Entry = { kind: "header"; bucket: Bucket } | { kind: "recipe"; recipe: Recipe };

const HEADER_HEIGHT = 48;
const ROW_HEIGHT = 64;
// How close to the top or bottom edge a dragged row has to be before the list scrolls, and how fast.
const EDGE = 72;
const SCROLL_SPEED = 700; // px per second at the very edge

const heightOf = (entry: Entry) => (entry.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT);
const keyOf = (entry: Entry) => (entry.kind === "header" ? entry.bucket : entry.recipe.id);

// This person's rated recipes, best first, under a header for each bucket.
function listFor(recipes: Recipe[], person: string): Entry[] {
	return BUCKETS.flatMap(({ value }) => [
		{ kind: "header", bucket: value } as Entry,
		...recipes
			.flatMap((recipe) => {
				const mine = ratingBy(recipe, person);
				return mine?.bucket === value ? [{ recipe, position: mine.position }] : [];
			})
			.sort((a, b) => b.position - a.position)
			.map(({ recipe }) => ({ kind: "recipe", recipe }) as Entry),
	]);
}

// Each recipe's bucket and place in it: the header above it, and how far below that header it sits.
function placements(entries: Entry[]) {
	const result = new Map<string, { bucket: Bucket; rank: number; size: number }>();
	let bucket: Bucket = "loved";
	let inBucket: string[] = [];
	const flush = () => inBucket.forEach((id, i) => result.set(id, { bucket, rank: i, size: inBucket.length }));
	for (const entry of entries) {
		if (entry.kind === "header") {
			flush();
			bucket = entry.bucket;
			inBucket = [];
		} else {
			inBucket.push(entry.recipe.id);
		}
	}
	flush();
	return result;
}

// The row being dragged: where it started, how far the finger has moved, and how far the list has
// auto-scrolled since it was picked up.
type Drag = { index: number; dy: number; scrollAtStart: number; scrolled: number };

// Where each entry starts, top to bottom.
function topsOf(entries: Entry[]) {
	const tops: number[] = [];
	let y = 0;
	for (const entry of entries) {
		tops.push(y);
		y += heightOf(entry);
	}
	return tops;
}

// Where the dragged row is now, in list coordinates.
const dragTop = (entries: Entry[], d: Drag) => topsOf(entries)[d.index] + d.dy + d.scrolled;

// The order the list would have if the dragged row were dropped right now.
function arrange(entries: Entry[], d: Drag | null): Entry[] {
	if (!d) return entries;
	const dragged = entries[d.index];
	const others = entries.filter((_, i) => i !== d.index);
	const center = dragTop(entries, d) + ROW_HEIGHT / 2;
	let y = 0;
	let slot = others.length;
	for (let i = 0; i < others.length; i++) {
		const h = heightOf(others[i]);
		if (y + h / 2 > center) {
			slot = i;
			break;
		}
		y += h;
	}
	// Never above the first header.
	slot = Math.max(1, slot);
	return [...others.slice(0, slot), dragged, ...others.slice(slot)];
}

// Web-only styles: a drag on the handle isn't a page scroll, and dragging doesn't select text.
const handleWeb = { touchAction: "none", cursor: "grab" } as object;
const noSelect = { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as object;

// Beli-style "reorder my list": drag recipes by their handle, including into another bucket.
// Nothing is saved until "save".
export default function ReorderSheet({
	visible,
	person,
	recipes,
	onClose,
	onSaved,
}: {
	visible: boolean;
	person: string;
	recipes: Recipe[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const topInset = useSheetTopInset();
	const [entries, setEntries] = useState(() => listFor(recipes, person));
	const [changed, setChanged] = useState(false);
	const [saving, setSaving] = useState(false);
	const [drag, setDrag] = useState<Drag | null>(null);
	const scrollRef = useRef<ScrollView>(null);
	const scrollY = useRef(0);
	const viewportHeight = useRef(0);
	// Latest values for the gesture handlers, which outlive renders.
	const live = useRef({ entries, drag });
	useLayoutEffect(() => {
		live.current = { entries, drag };
	});

	const tops = topsOf(entries);
	const totalHeight = entries.reduce((sum, e) => sum + heightOf(e), 0);

	// These three run from gesture handlers created once, so they read the latest state from refs.
	function startDrag(id: string) {
		const index = live.current.entries.findIndex((e) => keyOf(e) === id);
		setDrag({ index, dy: 0, scrollAtStart: scrollY.current, scrolled: 0 });
	}

	function moveDrag(dy: number) {
		setDrag((d) => d && { ...d, dy });
	}

	function endDrag() {
		const { drag: d, entries: current } = live.current;
		if (!d) return;
		const next = arrange(current, d);
		if (next.some((e, i) => keyOf(e) !== keyOf(current[i]))) setChanged(true);
		setEntries(next);
		setDrag(null);
	}

	// Scroll the list while a row is held near its top or bottom edge.
	useEffect(() => {
		if (!drag) return;
		let last = Date.now();
		const timer = setInterval(() => {
			const d = live.current.drag;
			// Distance goes by time passed, so it scrolls at the same speed however slowly ticks arrive.
			const now = Date.now();
			const elapsed = (now - last) / 1000;
			last = now;
			if (!d) return;
			// The finger stays put on screen while the list scrolls under it. The list stops itself at
			// the bottom; onScroll reports how far it really went.
			const fingerY = tops[d.index] - d.scrollAtStart + ROW_HEIGHT / 2 + d.dy;
			// Faster the closer the finger is to the edge.
			const step = (depth: number) => SCROLL_SPEED * elapsed * Math.min(1, Math.max(0.25, depth / EDGE));
			if (fingerY < EDGE && scrollY.current > 0) {
				scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current - step(EDGE - fingerY)), animated: false });
			} else if (fingerY > viewportHeight.current - EDGE) {
				const depth = fingerY - (viewportHeight.current - EDGE);
				scrollRef.current?.scrollTo({ y: scrollY.current + step(depth), animated: false });
			}
		}, 16);
		return () => clearInterval(timer);
		// Restart only when a drag starts or ends; the timer reads everything else from refs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [drag !== null]);

	async function save() {
		const place = placements(entries);
		const ratings = entries.flatMap((entry) => {
			if (entry.kind !== "recipe") return [];
			const { bucket, rank, size } = place.get(entry.recipe.id)!;
			// Best in the bucket gets the highest position; only the order matters.
			return [{ recipe_id: entry.recipe.id, bucket, position: size - rank }];
		});
		setSaving(true);
		try {
			await saveOrder(person, ratings);
			onSaved();
		} catch (error) {
			notify("couldn't save", (error as Error).message);
			setSaving(false);
		}
	}

	const shown = arrange(entries, drag);
	const place = placements(shown);
	const draggedKey = drag ? keyOf(entries[drag.index]) : null;
	const shownTops: number[] = [];
	let y = 0;
	for (const entry of shown) {
		shownTops.push(y);
		y += heightOf(entry);
	}

	return (
		<Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
			<View style={[styles.sheet, { paddingTop: topInset }, isWeb && noSelect]}>
				<View style={styles.header}>
					<Pressable onPress={onClose} hitSlop={12}>
						<Text style={styles.headerButton}>cancel</Text>
					</Pressable>
					<Text style={styles.headerTitle}>reorder my list</Text>
					{saving ? (
						<ActivityIndicator color={colors.primary} style={{ width: 56 }} />
					) : (
						<Pressable onPress={changed ? save : onClose} hitSlop={12}>
							<Text style={[styles.headerButton, styles.saveButton]}>{changed ? "save" : "done"}</Text>
						</Pressable>
					)}
				</View>
				<Text style={styles.hint}>drag ≡ to move a recipe, even into another bucket</Text>
				<ScrollView
					ref={scrollRef}
					style={{ flex: 1 }}
					scrollEnabled={!drag}
					scrollEventThrottle={16}
					onScroll={(e) => {
						const offset = e.nativeEvent.contentOffset.y;
						scrollY.current = offset;
						setDrag((d) => d && { ...d, scrolled: offset - d.scrollAtStart });
					}}
					onLayout={(e) => {
						viewportHeight.current = e.nativeEvent.layout.height;
					}}
				>
					<View style={{ height: totalHeight + 40 }}>
						{shown.map((entry, i) => {
							const top = shownTops[i];
							const key = keyOf(entry);
							const isDragged = key === draggedKey;
							const style = [styles.slot, { top: isDragged && drag ? dragTop(entries, drag) : top, height: heightOf(entry) }];
							if (entry.kind === "header") {
								const bucket = BUCKETS.find((b) => b.value === entry.bucket)!;
								return (
									<View key={key} style={[style, styles.bucketHeader]}>
										<Image source={bucket.image} style={styles.bucketImage} resizeMode="contain" />
										<Text style={styles.bucketLabel}>{bucket.label}</Text>
									</View>
								);
							}
							const { bucket, rank, size } = place.get(entry.recipe.id)!;
							const [lo, hi] = BUCKETS.find((b) => b.value === bucket)!.range;
							const score = Math.round((lo + ((hi - lo) * (size - rank)) / size) * 10) / 10;
							return (
								<View key={key} style={[style, isDragged && styles.dragging]}>
									<View style={styles.row}>
										<Image
											source={
												entry.recipe.photo
													? { uri: photoUrl(entry.recipe.photo) }
													: require("../assets/nailong.jpg")
											}
											style={styles.photo}
										/>
										<Text style={styles.title} numberOfLines={1}>
											{entry.recipe.title}
										</Text>
										<ScoreBadge score={score} size={30} />
										<DragHandle
											onStart={() => startDrag(entry.recipe.id)}
											onMove={moveDrag}
											onEnd={endDrag}
										/>
									</View>
								</View>
							);
						})}
					</View>
				</ScrollView>
			</View>
		</Modal>
	);
}

// The ≡ grip. Press and drag it to move its row. The handlers are fixed when it first renders.
function DragHandle({ onStart, onMove, onEnd }: { onStart: () => void; onMove: (dy: number) => void; onEnd: () => void }) {
	const [responder] = useState(() =>
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onStartShouldSetPanResponderCapture: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderTerminationRequest: () => false,
			onPanResponderGrant: () => onStart(),
			onPanResponderMove: (_, gesture) => onMove(gesture.dy),
			onPanResponderRelease: () => onEnd(),
			onPanResponderTerminate: () => onEnd(),
		}),
	);
	return (
		<View {...responder.panHandlers} style={[styles.handle, isWeb && handleWeb]}>
			<View style={styles.grip} />
			<View style={styles.grip} />
			<View style={styles.grip} />
		</View>
	);
}

const styles = StyleSheet.create({
	sheet: {
		flex: 1,
		backgroundColor: colors.background,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 14,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	headerButton: {
		width: 56,
		fontSize: 16,
		fontFamily: fonts.medium,
		color: colors.primary,
	},
	saveButton: {
		textAlign: "right",
		fontFamily: fonts.semibold,
	},
	headerTitle: {
		fontSize: 17,
		fontFamily: fonts.bold,
		color: colors.text,
	},
	hint: {
		fontSize: 13,
		fontFamily: fonts.regular,
		color: colors.muted,
		textAlign: "center",
		paddingVertical: 10,
	},
	slot: {
		position: "absolute",
		left: 16,
		right: 16,
	},
	bucketHeader: {
		flexDirection: "row",
		alignItems: "flex-end",
		gap: 8,
		paddingBottom: 8,
	},
	bucketImage: {
		width: 28,
		height: 28,
	},
	bucketLabel: {
		fontSize: 15,
		fontFamily: fonts.bold,
		color: colors.text,
	},
	row: {
		height: ROW_HEIGHT - 6,
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingLeft: 8,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.background,
	},
	dragging: {
		zIndex: 10,
		transform: [{ scale: 1.03 }],
		boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
	},
	photo: {
		width: 42,
		height: 42,
		borderRadius: radius.md,
	},
	title: {
		flex: 1,
		fontSize: 15,
		fontFamily: fonts.semibold,
		color: colors.text,
	},
	handle: {
		alignSelf: "stretch",
		justifyContent: "center",
		gap: 4,
		paddingHorizontal: 16,
	},
	grip: {
		width: 18,
		height: 2,
		borderRadius: 1,
		backgroundColor: colors.muted,
	},
});
