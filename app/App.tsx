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
	FlatList,
	Image,
	Pressable,
	RefreshControl,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import DupePicker from "./components/DupePicker";
import LogSheet, { type SheetMode } from "./components/LogSheet";
import MenuSheet, { type MenuAction } from "./components/MenuSheet";
import RecipeCard from "./components/RecipeCard";
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
import { groupDupes } from "./lib/dupes";
import { confirm, notify, storage } from "./lib/platform";
import { colors, fonts, glow, radius } from "./lib/theme";

const PERSON_KEY = "person";
const API_KEY_KEY = "apiKey";
const nailong = require("./assets/nailong.jpg");

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
	const [sort, setSort] = useState<"recent" | "top">("recent");
	const [sheetOpen, setSheetOpen] = useState(false);
	const [sheetMode, setSheetMode] = useState<SheetMode>("new");
	// The recipe being rated or edited (null when logging a new one).
	const [sheetRecipe, setSheetRecipe] = useState<Recipe | null>(null);
	// Remounting the sheet clears its form each time it opens.
	const [sheetKey, setSheetKey] = useState(0);
	const [menuRecipe, setMenuRecipe] = useState<Recipe | null>(null);
	// The recipe being marked as a dupe of another.
	const [dupeRecipe, setDupeRecipe] = useState<Recipe | null>(null);

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

	return (
		<SafeAreaView style={styles.screen} edges={["top"]}>
			<View style={styles.header}>
				<Logo />
				<Pressable onPress={switchPerson} hitSlop={12} style={styles.avatar}>
					<Text style={styles.avatarText}>{person[0]?.toLowerCase()}</Text>
				</Pressable>
			</View>
			<View style={styles.tabs}>
				{(["recent", "top"] as const).map((s) => (
					<Pressable key={s} style={[styles.tab, sort === s && styles.tabActive]} onPress={() => setSort(s)}>
						<Text style={[styles.tabText, sort === s && styles.tabTextActive]}>{s}</Text>
					</Pressable>
				))}
			</View>

			{error && !recipes ? (
				<View style={styles.center}>
					<ErrorMessage message={error} onRetry={load} />
				</View>
			) : !recipes ? (
				<Loading />
			) : (
				<FlatList
					data={groups}
					keyExtractor={(g) => g.key.group_id}
					contentContainerStyle={styles.list}
					indicatorStyle="white"
					refreshControl={
						<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.muted} />
					}
					ListEmptyComponent={
						<View style={styles.empty}>
							<Image source={nailong} style={styles.emptyImage} />
							<Text style={styles.emptyText}>nothing yet 🤯 tap + to log something you cooked</Text>
						</View>
					}
					renderItem={({ item, index }) => (
						<RecipeCard
							recipe={item.key}
							others={item.others}
							people={people}
							person={person}
							place={sort === "top" ? index + 1 : undefined}
							onRate={() => openSheet("rate", item.key)}
							onMenu={setMenuRecipe}
						/>
					)}
				/>
			)}

			<Pressable
				style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
				onPress={() => openSheet("new", null)}
			>
				<Text style={styles.fabText}>+</Text>
			</Pressable>

			<MenuSheet title={menuRecipe?.title ?? ""} actions={menuActions} onClose={() => setMenuRecipe(null)} />

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
	tabs: {
		flexDirection: "row",
		marginHorizontal: 20,
		marginVertical: 14,
		backgroundColor: colors.border,
		borderRadius: radius.lg,
		padding: 4,
	},
	tab: {
		flex: 1,
		alignItems: "center",
		paddingVertical: 7,
		borderRadius: radius.md,
	},
	tabActive: {
		backgroundColor: colors.background,
	},
	tabText: {
		fontSize: 14,
		fontFamily: fonts.medium,
		color: colors.muted,
	},
	tabTextActive: {
		color: colors.text,
	},
	list: {
		paddingHorizontal: 20,
		paddingBottom: 120,
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
