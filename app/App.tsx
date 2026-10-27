import {
	Inter_400Regular,
	Inter_500Medium,
	Inter_600SemiBold,
	Inter_700Bold,
	useFonts,
} from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	Image,
	Modal,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	useWindowDimensions,
	View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import DupePicker from "./components/DupePicker";
import GridCard, { gridCardHeight } from "./components/GridCard";
import LogSheet, { type SheetMode } from "./components/LogSheet";
import MenuSheet, { type MenuAction } from "./components/MenuSheet";
import RecipeCard from "./components/RecipeCard";
import ReorderSheet from "./components/ReorderSheet";
import {
	deleteRecipe,
	getPeople,
	getRecipes,
	hasApiKey,
	markDupe,
	ratingBy,
	setApiKey,
	unlinkDupe,
	type Recipe,
} from "./lib/api";
import { groupDupes, type Group } from "./lib/dupes";
import { confirm, isWeb, notify, storage, useSheetTopInset } from "./lib/platform";
import { colors, fonts, glow, radius } from "./lib/theme";

const PERSON_KEY = "person";
const API_KEY_KEY = "apiKey";
const nailong = require("./assets/nailong.jpg");
const SORTS = { recent: "most recent", top: "top rated" } as const;
const LIST_PADDING = 20;
const COLUMN_GAP = 12;

export default function App() {
	const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
	return (
		<SafeAreaProvider>
			<StatusBar style="light" />
			{fontsLoaded ? <Home /> : <Loading />}
		</SafeAreaProvider>
	);
}

function Home() {
	// undefined = still reading from storage, null = not chosen yet
	const [person, setPerson] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		(async () => {
			const savedKey = await storage.get(API_KEY_KEY);
			if (savedKey) setApiKey(savedKey);
			setPerson(await storage.get(PERSON_KEY));
		})();
	}, []);

	async function choosePerson(name: string | null) {
		if (name) await storage.set(PERSON_KEY, name);
		else await storage.remove(PERSON_KEY);
		setPerson(name);
	}

	if (person === undefined) return <Loading />;
	if (person === null || !hasApiKey()) return <PersonPicker onPick={choosePerson} />;
	return <Recipes person={person} onSwitch={() => choosePerson(null)} />;
}

function Loading() {
	return (
		<View style={styles.center}>
			<ActivityIndicator color={colors.primary} />
		</View>
	);
}

function Logo({ size = 28 }: { size?: number }) {
	const icon = { width: size * 0.8, height: size * 0.8, borderRadius: size * 0.4 };
	return (
		<View style={styles.logo}>
			<Image source={nailong} style={icon} />
			<Text style={[styles.logoText, { fontSize: size }]}>nailong kitchen</Text>
			<Image source={nailong} style={icon} />
		</View>
	);
}

// Mirrors food-gallery's sign-in card, glow and all. The web app asks for the passcode
// (the server's API_KEY) first, since it can't have it built in.
function PersonPicker({ onPick }: { onPick: (name: string) => void }) {
	const [people, setPeople] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [needsPasscode, setNeedsPasscode] = useState(!hasApiKey());
	const [passcode, setPasscode] = useState("");

	const load = useCallback(() => {
		if (!hasApiKey()) return;
		setError(null);
		getPeople()
			.then(setPeople)
			.catch((e: Error) => setError(e.message));
	}, []);
	useEffect(load, [load]);

	async function submitPasscode() {
		setApiKey(passcode.trim());
		try {
			setPeople(await getPeople());
			await storage.set(API_KEY_KEY, passcode.trim());
			setNeedsPasscode(false);
		} catch {
			setApiKey("");
			notify("wrong passcode", "ask the other person for it, or check the server's API_KEY.");
		}
	}

	return (
		<SafeAreaView style={[styles.screen, styles.center]}>
			<View style={styles.pickerWrap}>
				<View style={styles.glow} />
				<View style={styles.pickerCard}>
					<Logo size={22} />
					<Text style={styles.pickerSubtitle}>
						{needsPasscode ? "welcome to nailong kitchen 🤯 what's the passcode?" : "welcome to nailong kitchen 🤯 who are you?"}
					</Text>
					{needsPasscode ? (
						<>
							<TextInput
								style={styles.passcodeInput}
								placeholder="passcode"
								placeholderTextColor={colors.muted}
								value={passcode}
								onChangeText={setPasscode}
								onSubmitEditing={submitPasscode}
								autoCapitalize="none"
								autoCorrect={false}
								keyboardAppearance="dark"
							/>
							<Pressable
								style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
								onPress={submitPasscode}
							>
								<Text style={styles.primaryButtonText}>continue</Text>
							</Pressable>
						</>
					) : error ? (
						<ErrorMessage message={error} onRetry={load} />
					) : !people ? (
						<ActivityIndicator color={colors.primary} />
					) : (
						people.map((name) => (
							<Pressable
								key={name}
								style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
								onPress={() => onPick(name)}
							>
								<Text style={styles.outlineButtonText}>{name}</Text>
							</Pressable>
						))
					)}
				</View>
			</View>
		</SafeAreaView>
	);
}

function Recipes({ person, onSwitch }: { person: string; onSwitch: () => void }) {
	const [recipes, setRecipes] = useState<Recipe[] | null>(null);
	const [people, setPeople] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [sort, setSort] = useState<keyof typeof SORTS>("recent");
	const [sortOpen, setSortOpen] = useState(false);
	// null = search closed; otherwise what's typed so far.
	const [query, setQuery] = useState<string | null>(null);
	// The ••• menu next to sort (search, reorder).
	const [moreOpen, setMoreOpen] = useState(false);
	const [reorderOpen, setReorderOpen] = useState(false);
	// Remounting the reorder sheet starts it from the latest list each time.
	const [reorderKey, setReorderKey] = useState(0);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [sheetMode, setSheetMode] = useState<SheetMode>("new");
	// The recipe being rated or edited (null when logging a new one).
	const [sheetRecipe, setSheetRecipe] = useState<Recipe | null>(null);
	// Remounting the sheet clears its form each time it opens.
	const [sheetKey, setSheetKey] = useState(0);
	const [menuRecipe, setMenuRecipe] = useState<Recipe | null>(null);
	// The recipe being marked as a dupe of another.
	const [dupeRecipe, setDupeRecipe] = useState<Recipe | null>(null);
	// The dish whose full card is open (by group, so it stays put when its best cook changes).
	const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
	// Which cook of that dish the full card shows (null = its best one).
	const [detailRecipeId, setDetailRecipeId] = useState<string | null>(null);
	const { width: screenWidth } = useWindowDimensions();
	const sheetTopInset = useSheetTopInset();

	const load = useCallback(async () => {
		try {
			const [nextRecipes, nextPeople] = await Promise.all([getRecipes(), getPeople()]);
			setRecipes(nextRecipes);
			setPeople(nextPeople);
			setError(null);
		} catch (e) {
			setError((e as Error).message);
		}
	}, []);
	useEffect(() => {
		load();
		// Pick up the other person's changes when coming back to the app.
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") load();
		});
		return () => subscription.remove();
	}, [load]);

	async function refresh() {
		setRefreshing(true);
		await load();
		setRefreshing(false);
	}

	const menuActions: MenuAction[] | null = menuRecipe && [
		{ label: "edit details", onPress: () => openSheet("edit", menuRecipe) },
		{
			label: ratingBy(menuRecipe, person) ? "redo my rating" : "rate it",
			onPress: () => openSheet("rate", menuRecipe),
		},
		{ label: "mark dupe", onPress: () => setDupeRecipe(menuRecipe) },
		...(recipes?.some((r) => r.group_id === menuRecipe.group_id && r.id !== menuRecipe.id)
			? [{ label: "unlink", onPress: () => unlink(menuRecipe) }]
			: []),
		{ label: "delete", destructive: true, onPress: () => confirmDelete(menuRecipe) },
	];

	async function confirmDelete(recipe: Recipe) {
		if (!(await confirm(`delete "${recipe.title}"?`, "this can't be undone.", "delete", true))) return;
		try {
			await deleteRecipe(recipe.id);
			await load();
		} catch (e) {
			notify("couldn't delete", (e as Error).message);
		}
	}

	async function linkDupe(recipe: Recipe, dupeOf: Recipe) {
		setDupeRecipe(null);
		try {
			await markDupe(recipe.id, dupeOf.id);
			await load();
		} catch (e) {
			notify("couldn't mark dupe", (e as Error).message);
		}
	}

	async function unlink(recipe: Recipe) {
		try {
			await unlinkDupe(recipe.id);
			await load();
		} catch (e) {
			notify("couldn't unlink", (e as Error).message);
		}
	}

	// Closes the full card, then does something that opens its own sheet.
	function fromDetail(action: () => void) {
		setDetailGroupId(null);
		// iOS can't present the next sheet until this one has finished closing.
		setTimeout(action, isWeb ? 0 : 350);
	}

	async function switchPerson() {
		if (await confirm(`you're @${person}`, "switch to the other person on this phone?", "switch")) onSwitch();
	}

	function openSheet(mode: SheetMode, recipe: Recipe | null) {
		setSheetMode(mode);
		setSheetRecipe(recipe);
		setSheetKey((k) => k + 1);
		setSheetOpen(true);
	}

	// Dupes show as one card: recent goes by when the dish was last cooked, top by its best cook.
	const groups = groupDupes(recipes ?? []).sort((a, b) =>
		sort === "recent" ? b.latest.localeCompare(a.latest) : (b.key.score ?? -1) - (a.key.score ?? -1),
	);
	const detailGroup = groups.find((g) => g.key.group_id === detailGroupId);
	const detailCooks = detailGroup ? [detailGroup.key, ...detailGroup.others] : [];
	const detailRecipe = detailCooks.find((r) => r.id === detailRecipeId) ?? detailGroup?.key;
	// The rest of the dish's cooks, newest first, listed under the one shown.
	const detailOthers = detailCooks
		.filter((r) => r !== detailRecipe)
		.sort((a, b) => b.created_at.localeCompare(a.created_at));
	// Searching matches any cook's name or notes, and keeps each dish's place in the full ranking.
	const search = query?.trim().toLowerCase() ?? "";
	const shown = groups
		.map((group, index) => ({ group, place: index + 1 }))
		.filter(({ group }) =>
			[group.key, ...group.others].some((r) => `${r.title} ${r.note ?? ""}`.toLowerCase().includes(search)),
		);

	// Two-column masonry: each card goes into whichever column is shorter so far, so cards earlier
	// in the order (newer, or better rated) always sit higher up the screen.
	const columnWidth = (screenWidth - LIST_PADDING * 2 - COLUMN_GAP) / 2;
	const columns: { group: Group; place: number }[][] = [[], []];
	const heights = [0, 0];
	shown.forEach(({ group, place }) => {
		const column = heights[0] <= heights[1] ? 0 : 1;
		columns[column].push({ group, place });
		heights[column] += gridCardHeight(group, columnWidth);
	});

	return (
		<SafeAreaView style={styles.screen} edges={["top"]}>
			<View style={styles.header}>
				<Logo />
				<Pressable onPress={switchPerson} hitSlop={12} style={styles.avatar}>
					<Text style={styles.avatarText}>{person[0]?.toLowerCase()}</Text>
				</Pressable>
			</View>
			<View style={styles.sortRow}>
				{query === null ? (
					<>
						<Pressable
							style={({ pressed }) => [styles.sortButton, sortOpen && styles.sortButtonOpen, pressed && styles.pressed]}
							onPress={() => {
								setMoreOpen(false);
								setSortOpen(!sortOpen);
							}}
						>
							<Text style={styles.sortLabel}>sort</Text>
							<Text style={styles.sortValue}>{SORTS[sort]}</Text>
							<Text style={styles.sortLabel}>{sortOpen ? "▴" : "▾"}</Text>
						</Pressable>
						<Pressable
							style={({ pressed }) => [styles.moreButton, moreOpen && styles.sortButtonOpen, pressed && styles.pressed]}
							onPress={() => {
								setSortOpen(false);
								setMoreOpen(!moreOpen);
							}}
							hitSlop={8}
							accessibilityLabel="more"
						>
							<Text style={styles.moreText}>•••</Text>
						</Pressable>
					</>
				) : (
					<>
						<View style={styles.searchField}>
							<SearchIcon />
							<TextInput
								style={styles.searchInput}
								placeholder="search recipes"
								placeholderTextColor={colors.muted}
								keyboardAppearance="dark"
								value={query}
								onChangeText={setQuery}
								autoFocus
								autoCorrect={false}
								returnKeyType="search"
							/>
						</View>
						<Pressable onPress={() => setQuery(null)} hitSlop={12}>
							<Text style={styles.searchCancel}>cancel</Text>
						</Pressable>
					</>
				)}
				{sortOpen ? (
					<View style={styles.dropdown}>
						{(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((s) => (
							<Pressable
								key={s}
								style={({ pressed }) => [styles.dropdownOption, pressed && styles.dropdownPressed]}
								onPress={() => {
									setSort(s);
									setSortOpen(false);
								}}
							>
								<Text style={[styles.dropdownText, sort === s && styles.dropdownTextActive]}>{SORTS[s]}</Text>
								{sort === s ? <Text style={styles.dropdownCheck}>✓</Text> : null}
							</Pressable>
						))}
					</View>
				) : null}
				{moreOpen ? (
					<View style={[styles.dropdown, styles.dropdownRight]}>
						<Pressable
							style={({ pressed }) => [styles.dropdownOption, pressed && styles.dropdownPressed]}
							onPress={() => {
								setMoreOpen(false);
								setQuery("");
							}}
						>
							<Text style={[styles.dropdownText, styles.dropdownTextActive]}>search</Text>
							<SearchIcon />
						</Pressable>
						<Pressable
							style={({ pressed }) => [styles.dropdownOption, pressed && styles.dropdownPressed]}
							onPress={() => {
								setMoreOpen(false);
								setReorderKey((k) => k + 1);
								setReorderOpen(true);
							}}
						>
							<Text style={[styles.dropdownText, styles.dropdownTextActive]}>reorder my list</Text>
							<Text style={styles.dropdownIcon}>⇅</Text>
						</Pressable>
					</View>
				) : null}
			</View>

			{error && !recipes ? (
				<View style={styles.center}>
					<ErrorMessage message={error} onRetry={load} />
				</View>
			) : !recipes ? (
				<Loading />
			) : (
				<ScrollView
					contentContainerStyle={styles.list}
					indicatorStyle="white"
					refreshControl={
						<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />
					}
				>
					{shown.length === 0 ? (
						<View style={styles.empty}>
							<Image source={nailong} style={styles.emptyImage} />
							<Text style={styles.emptyText}>
								{groups.length === 0
									? "nothing yet 🤯 tap + to log something you cooked"
									: `nothing matches "${query?.trim()}" 🤯`}
							</Text>
						</View>
					) : (
						<View style={styles.columns}>
							{columns.map((column, i) => (
								<View key={i} style={{ width: columnWidth }}>
									{column.map(({ group, place }) => (
										<GridCard
											key={group.key.group_id}
											group={group}
											people={people}
											width={columnWidth}
											place={sort === "top" ? place : undefined}
											onPress={() => {
												setDetailRecipeId(null);
												setDetailGroupId(group.key.group_id);
											}}
											onMenu={setMenuRecipe}
										/>
									))}
								</View>
							))}
						</View>
					)}
				</ScrollView>
			)}

			{/* Tapping anywhere else closes the sort dropdown. */}
			{sortOpen || moreOpen ? (
				<Pressable
					style={styles.backdrop}
					onPress={() => {
						setSortOpen(false);
						setMoreOpen(false);
					}}
				/>
			) : null}

			<Pressable
				style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
				onPress={() => openSheet("new", null)}
			>
				<Text style={styles.fabText}>+</Text>
			</Pressable>

			<Modal
				visible={detailGroup !== undefined}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setDetailGroupId(null)}
			>
				<View style={[styles.detail, { paddingTop: sheetTopInset }]}>
					<View style={styles.detailHeader}>
						<Pressable onPress={() => setDetailGroupId(null)} hitSlop={12}>
							<Text style={styles.detailClose}>close</Text>
						</Pressable>
					</View>
					{/* Keyed by cook so switching to another one starts back at the top. */}
					<ScrollView key={detailRecipe?.id} contentContainerStyle={styles.detailBody}>
						{detailRecipe ? (
							<RecipeCard
								key={detailRecipe.id}
								recipe={detailRecipe}
								others={detailOthers}
								people={people}
								person={person}
								defaultExpanded
								onRate={() => fromDetail(() => openSheet("rate", detailRecipe))}
								onOpen={(recipe) => setDetailRecipeId(recipe.id)}
								onMenu={(recipe) => fromDetail(() => setMenuRecipe(recipe))}
							/>
						) : null}
					</ScrollView>
				</View>
			</Modal>

			<MenuSheet title={menuRecipe?.title ?? ""} actions={menuActions} onClose={() => setMenuRecipe(null)} />

			<ReorderSheet
				key={reorderKey}
				visible={reorderOpen}
				person={person}
				recipes={recipes ?? []}
				onClose={() => setReorderOpen(false)}
				onSaved={() => {
					setReorderOpen(false);
					load();
				}}
			/>

			<DupePicker
				recipe={dupeRecipe}
				recipes={recipes ?? []}
				onClose={() => setDupeRecipe(null)}
				onPick={(dupeOf) => linkDupe(dupeRecipe!, dupeOf)}
			/>

			<LogSheet
				key={sheetKey}
				visible={sheetOpen}
				person={person}
				mode={sheetMode}
				recipes={recipes ?? []}
				recipe={sheetRecipe}
				onClose={() => setSheetOpen(false)}
				onSaved={() => {
					setSheetOpen(false);
					load();
				}}
			/>
		</SafeAreaView>
	);
}

// A magnifying glass drawn with views, so it doesn't depend on an icon font.
function SearchIcon() {
	return (
		<View style={styles.searchIcon}>
			<View style={styles.searchIconLens} />
			<View style={styles.searchIconHandle} />
		</View>
	);
}

function ErrorMessage({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<View style={styles.errorBox}>
			<Text style={styles.errorText}>{message}</Text>
			<Pressable onPress={onRetry} hitSlop={12}>
				<Text style={styles.retry}>try again</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: colors.background,
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.background,
	},
	logo: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	logoText: {
		fontFamily: fonts.bold,
		color: colors.text,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 20,
		paddingTop: 8,
		paddingBottom: 4,
	},
	avatar: {
		width: 40,
		height: 40,
		borderRadius: 20,
		borderWidth: 2,
		borderColor: colors.text,
		alignItems: "center",
		justifyContent: "center",
	},
	avatarText: {
		fontSize: 20,
		fontFamily: fonts.bold,
		color: colors.text,
	},
	sortRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		minHeight: 36,
		marginHorizontal: 20,
		marginVertical: 14,
		// Keeps the dropdown above the list and the backdrop.
		zIndex: 10,
	},
	sortButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: 12,
		paddingVertical: 7,
	},
	sortButtonOpen: {
		borderColor: colors.muted,
		backgroundColor: colors.card,
	},
	sortLabel: {
		fontSize: 14,
		fontFamily: fonts.regular,
		color: colors.muted,
	},
	sortValue: {
		fontSize: 14,
		fontFamily: fonts.semibold,
		color: colors.text,
	},
	moreButton: {
		width: 44,
		height: 36,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: "center",
		justifyContent: "center",
	},
	moreText: {
		fontSize: 14,
		letterSpacing: 1,
		color: colors.text,
	},
	dropdownRight: {
		left: undefined,
		right: 0,
	},
	dropdownIcon: {
		width: 16,
		textAlign: "center",
		fontSize: 16,
		color: colors.muted,
	},
	searchField: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		height: 36,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.muted,
		backgroundColor: colors.card,
		paddingHorizontal: 12,
	},
	searchInput: {
		flex: 1,
		height: "100%",
		// 16px keeps iOS Safari from zooming in when the field is focused.
		fontSize: 16,
		fontFamily: fonts.regular,
		color: colors.text,
		// The field's own border shows focus; drop the browser's outline (a web-only value).
		...(isWeb ? ({ outlineStyle: "none" } as object) : {}),
	},
	searchCancel: {
		fontSize: 15,
		fontFamily: fonts.medium,
		color: colors.primary,
	},
	searchIcon: {
		width: 16,
		height: 16,
	},
	searchIconLens: {
		width: 12,
		height: 12,
		borderRadius: 6,
		borderWidth: 2,
		borderColor: colors.muted,
	},
	searchIconHandle: {
		position: "absolute",
		right: 0,
		bottom: 1,
		width: 6,
		height: 2,
		borderRadius: 1,
		backgroundColor: colors.muted,
		transform: [{ rotate: "45deg" }],
	},
	dropdown: {
		position: "absolute",
		top: "100%",
		left: 0,
		marginTop: 6,
		minWidth: 180,
		backgroundColor: colors.card,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		padding: 4,
		boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
	},
	dropdownOption: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: radius.md,
	},
	dropdownPressed: {
		backgroundColor: colors.border,
	},
	dropdownText: {
		fontSize: 15,
		fontFamily: fonts.medium,
		color: colors.muted,
	},
	dropdownTextActive: {
		color: colors.text,
	},
	dropdownCheck: {
		fontSize: 14,
		fontFamily: fonts.bold,
		color: colors.primary,
	},
	backdrop: {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		zIndex: 5,
	},
	list: {
		paddingHorizontal: LIST_PADDING,
		paddingBottom: 120,
	},
	columns: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: COLUMN_GAP,
	},
	detail: {
		flex: 1,
		backgroundColor: colors.background,
	},
	detailHeader: {
		paddingHorizontal: 16,
		paddingVertical: 14,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	detailClose: {
		fontSize: 16,
		fontFamily: fonts.medium,
		color: colors.primary,
	},
	detailBody: {
		padding: LIST_PADDING,
	},
	empty: {
		alignItems: "center",
		gap: 16,
		marginTop: 64,
	},
	emptyImage: {
		width: 92,
		height: 92,
		borderRadius: 46,
	},
	emptyText: {
		textAlign: "center",
		color: colors.muted,
		fontSize: 15,
		fontFamily: fonts.regular,
	},
	fab: {
		position: "absolute",
		right: 24,
		bottom: 40,
		width: 60,
		height: 60,
		borderRadius: 30,
		backgroundColor: colors.primary,
		alignItems: "center",
		justifyContent: "center",
		boxShadow: "0 0 24px 4px rgba(59, 130, 246, 0.5)",
	},
	fabText: {
		color: colors.primaryText,
		fontSize: 32,
		fontFamily: fonts.medium,
		marginTop: -2,
	},
	pressed: {
		opacity: 0.75,
	},
	pickerWrap: {
		width: "100%",
		paddingHorizontal: 24,
		alignItems: "center",
		justifyContent: "center",
	},
	glow: {
		position: "absolute",
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: "#fff",
		boxShadow: glow,
	},
	pickerCard: {
		width: "100%",
		maxWidth: 384,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		padding: 20,
		gap: 20,
	},
	pickerSubtitle: {
		fontSize: 14,
		fontFamily: fonts.regular,
		color: "#D1D5DB",
	},
	passcodeInput: {
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.background,
		paddingHorizontal: 12,
		paddingVertical: 11,
		fontSize: 16,
		fontFamily: fonts.regular,
		color: colors.text,
	},
	primaryButton: {
		backgroundColor: colors.primary,
		borderRadius: radius.md,
		paddingVertical: 12,
		alignItems: "center",
	},
	primaryButtonText: {
		color: colors.primaryText,
		fontSize: 15,
		fontFamily: fonts.semibold,
	},
	outlineButton: {
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.background,
		paddingVertical: 11,
		alignItems: "center",
	},
	outlineButtonText: {
		fontSize: 15,
		fontFamily: fonts.medium,
		color: colors.text,
	},
	errorBox: {
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 32,
	},
	errorText: {
		color: colors.text,
		fontSize: 15,
		fontFamily: fonts.regular,
		textAlign: "center",
	},
	retry: {
		color: colors.primary,
		fontSize: 16,
		fontFamily: fonts.semibold,
	},
});
