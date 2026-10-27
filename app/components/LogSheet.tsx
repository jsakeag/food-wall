import { parse as parseExif } from "exifr";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Image,
	KeyboardAvoidingView,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";
import { createRecipe, photoUrl, rateRecipe, ratingBy, updateRecipe, type Bucket, type Recipe } from "../lib/api";
import { likelyDupes } from "../lib/dupes";
import { answer, isDone, midpoint, positionAt, startSearch, tie, type Search } from "../lib/ranking";
import { isWeb, notify } from "../lib/platform";
import { BUCKETS, colors, fonts, radius } from "../lib/theme";
import RecipeRow from "./RecipeRow";

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
	mediaTypes: "images",
	allowsEditing: true,
	quality: 0.7,
	exif: true,
};

// When the photo was taken, read from its EXIF data in the phone's time zone. The web picker
// doesn't return EXIF, but it hands over the original file, so it's parsed from that instead.
async function photoTakenAt(asset: ImagePicker.ImagePickerAsset): Promise<string | null> {
	try {
		let date: Date | undefined;
		if (isWeb) {
			date = asset.file ? (await parseExif(asset.file, ["DateTimeOriginal"]))?.DateTimeOriginal : undefined;
		} else {
			// e.g. "2026:10:27 18:30:00"
			const [y, mo, d, h, mi, s] = String(asset.exif?.DateTimeOriginal ?? "").split(/[: ]/).map(Number);
			if (y) date = new Date(y, mo - 1, d, h, mi, s);
		}
		return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
	} catch {
		return null;
	}
}

export type SheetMode = "new" | "rate" | "edit";

// "new" logs a recipe (and rates it), "rate" adds or redoes this person's rating of `recipe`,
// "edit" changes `recipe`'s name, link, notes or photo.
export default function LogSheet({
	visible,
	mode,
	person,
	recipes,
	recipe: existing,
	onClose,
	onSaved,
}: {
	visible: boolean;
	mode: SheetMode;
	person: string;
	recipes: Recipe[];
	recipe: Recipe | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [step, setStep] = useState<"form" | "dupe" | "compare" | "saving">("form");
	const [photoUri, setPhotoUri] = useState<string | null>(null);
	const [madeAt, setMadeAt] = useState<string | null>(null);
	const [title, setTitle] = useState(existing?.title ?? "");
	const [sourceUrl, setSourceUrl] = useState(existing?.source_url ?? "");
	const [note, setNote] = useState(existing?.note ?? "");
	const [bucket, setBucket] = useState<Bucket | null>(
		existing && mode === "rate" ? (ratingBy(existing, person)?.bucket ?? null) : null,
	);
	// Recipes this person put in the chosen bucket, best first.
	const [list, setList] = useState<{ recipe: Recipe; position: number }[]>([]);
	const [search, setSearch] = useState<Search>({ lo: 0, hi: 0 });
	// Logged recipes that look like the same dish, and the one picked as "same as", if any.
	const [dupes, setDupes] = useState<Recipe[]>([]);
	const [dupeOf, setDupeOf] = useState<string | null>(null);

	async function pickPhoto(source: "camera" | "library") {
		if (source === "camera") {
			const { granted } = await ImagePicker.requestCameraPermissionsAsync();
			if (!granted) {
				notify("camera access is off", "turn it on in Settings to take photos.");
				return;
			}
		}
		const result =
			source === "camera"
				? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
				: await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
		if (result.canceled) return;
		setPhotoUri(result.assets[0].uri);
		setMadeAt(await photoTakenAt(result.assets[0]));
	}

	function choosePhoto() {
		// In Safari the file picker already offers "Take Photo" and "Photo Library".
		if (isWeb) return pickPhoto("library");
		Alert.alert("add a photo", undefined, [
			{ text: "take photo", onPress: () => pickPhoto("camera") },
			{ text: "choose from library", onPress: () => pickPhoto("library") },
			{ text: "cancel", style: "cancel" },
		]);
	}

	async function save(position: number, sameAs = dupeOf) {
		setStep("saving");
		try {
			if (mode === "rate") {
				await rateRecipe(existing!.id, person, bucket!, position);
			} else {
				await createRecipe({
					person,
					title: title.trim(),
					source_url: sourceUrl,
					note,
					bucket: bucket!,
					position,
					photoUri,
					madeAt,
					dupeOf: sameAs,
				});
			}
			onSaved();
		} catch (error) {
			notify("couldn't save", (error as Error).message);
			setStep("form");
		}
	}

	async function saveEdit() {
		setStep("saving");
		try {
			await updateRecipe(existing!.id, { title: title.trim(), source_url: sourceUrl, note, photoUri, madeAt });
			onSaved();
		} catch (error) {
			notify("couldn't save", (error as Error).message);
			setStep("form");
		}
	}

	function next() {
		if (!title.trim()) return notify("give the recipe a name");
		if (mode === "edit") return saveEdit();
		if (!bucket) return notify("how was it?", "pick loved it, it was fine or didn't like it.");
		if (mode === "new") {
			const matches = likelyDupes(title, recipes);
			if (matches.length > 0) {
				setDupes(matches);
				setStep("dupe");
				return;
			}
		}
		rank(null);
	}

	// Rate it against this person's other recipes in the bucket (each cook of a dupe is rated too).
	function rank(sameAs: string | null) {
		setDupeOf(sameAs);
		const candidates = recipes
			.filter((r) => r.id !== existing?.id)
			.flatMap((recipe) => {
				const mine = ratingBy(recipe, person);
				return mine?.bucket === bucket ? [{ recipe, position: mine.position }] : [];
			})
			.sort((a, b) => b.position - a.position);
		if (candidates.length === 0) return save(positionAt(candidates, 0), sameAs);
		setList(candidates);
		setSearch(startSearch(candidates));
		setStep("compare");
	}

	function settle(nextSearch: Search) {
		if (isDone(nextSearch)) save(positionAt(list, nextSearch.lo));
		else setSearch(nextSearch);
	}

	const other = list[midpoint(search)]?.recipe;
	const savedPhoto = existing?.photo ? photoUrl(existing.photo) : null;
	// What the recipe will look like: a newly picked photo wins over the saved one.
	const newPhoto = photoUri ?? savedPhoto;
	const heading = { new: "log a recipe", rate: "rate it", edit: "edit details" }[mode];
	const headerTitle = { form: heading, dupe: "cooked this before? 🤔", compare: "which was better? 🤔", saving: heading }[step];

	return (
		<Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
			<KeyboardAvoidingView behavior="padding" style={styles.sheet}>
				<View style={styles.header}>
					<Pressable onPress={step === "form" ? onClose : () => setStep("form")} hitSlop={12}>
						<Text style={styles.headerButton}>{step === "form" ? "cancel" : "back"}</Text>
					</Pressable>
					<Text style={styles.headerTitle}>{headerTitle}</Text>
					<View style={{ width: 56 }} />
				</View>

				{step === "saving" ? (
					<View style={styles.center}>
						<ActivityIndicator size="large" color={colors.primary} />
					</View>
				) : step === "dupe" ? (
					<ScrollView contentContainerStyle={styles.form}>
						<Text style={styles.label}>is it the same as one of these?</Text>
						{dupes.map((recipe) => (
							<RecipeRow key={recipe.id} recipe={recipe} onPress={() => rank(recipe.id)}>
								<Text style={styles.sameAs}>same</Text>
							</RecipeRow>
						))}
						<Pressable style={styles.secondaryButton} onPress={() => rank(null)}>
							<Text style={styles.secondaryButtonText}>{"no, it's something new"}</Text>
						</Pressable>
					</ScrollView>
				) : step === "compare" && other ? (
					<View style={styles.compare}>
						<View style={styles.choices}>
							<Choice
								title={title.trim()}
								photo={newPhoto}
								tag={mode === "new" ? "new" : "this one"}
								onPress={() => settle(answer(search, true))}
							/>
							<Choice
								title={other.title}
								photo={other.photo ? photoUrl(other.photo) : null}
								onPress={() => settle(answer(search, false))}
							/>
						</View>
						<Pressable style={styles.secondaryButton} onPress={() => settle(tie(search))}>
							<Text style={styles.secondaryButtonText}>too close to call</Text>
						</Pressable>
					</View>
				) : (
					<ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
						{mode === "rate" && existing ? (
							<View style={styles.existing}>
								<Image
									source={newPhoto ? { uri: newPhoto } : require("../assets/nailong.jpg")}
									style={styles.existingPhoto}
								/>
								<View style={{ flex: 1 }}>
									<Text style={styles.existingTitle}>{existing.title}</Text>
									<Text style={styles.existingMeta}>logged by @{existing.created_by}</Text>
								</View>
							</View>
						) : (
							<>
								<Pressable style={styles.photoPicker} onPress={choosePhoto}>
									{newPhoto ? (
										<Image source={{ uri: newPhoto }} style={styles.photoPreview} />
									) : (
										<Text style={styles.photoPickerText}>📷  add a photo</Text>
									)}
								</Pressable>

								<TextInput
									style={styles.input}
									placeholder="recipe name"
									placeholderTextColor={colors.muted}
									keyboardAppearance="dark"
									value={title}
									onChangeText={setTitle}
								/>
								<TextInput
									style={styles.input}
									placeholder="link (optional)"
									placeholderTextColor={colors.muted}
									keyboardAppearance="dark"
									value={sourceUrl}
									onChangeText={setSourceUrl}
									autoCapitalize="none"
									autoCorrect={false}
									keyboardType="url"
								/>
								<TextInput
									style={[styles.input, styles.noteInput]}
									placeholder="notes (optional)"
									placeholderTextColor={colors.muted}
									keyboardAppearance="dark"
									value={note}
									onChangeText={setNote}
									multiline
								/>
							</>
						)}

						{mode !== "edit" ? (
							<>
								<Text style={styles.label}>how was it?</Text>
								<View style={styles.buckets}>
									{BUCKETS.map((b) => (
										<Pressable
											key={b.value}
											style={[styles.bucket, bucket === b.value && styles.bucketSelected]}
											onPress={() => setBucket(b.value)}
										>
											<Image source={b.image} style={styles.bucketImage} resizeMode="contain" />
											<Text style={styles.bucketLabel}>{b.label}</Text>
										</Pressable>
									))}
								</View>
							</>
						) : null}

						<Pressable style={styles.primaryButton} onPress={next}>
							<Text style={styles.primaryButtonText}>{mode === "edit" ? "save" : "next"}</Text>
						</Pressable>
					</ScrollView>
				)}
			</KeyboardAvoidingView>
		</Modal>
	);
}

function Choice({
	title,
	photo,
	tag,
	onPress,
}: {
	title: string;
	photo: string | null;
	tag?: string;
	onPress: () => void;
}) {
	return (
		<Pressable style={({ pressed }) => [styles.choice, pressed && { opacity: 0.7 }]} onPress={onPress}>
			{photo ? (
				<Image source={{ uri: photo }} style={styles.choicePhoto} />
			) : (
				<View style={[styles.choicePhoto, styles.choiceNoPhoto]}>
					<Image source={require("../assets/nailong.jpg")} style={styles.choiceNailong} />
				</View>
			)}
			{tag ? <Text style={styles.choiceTag}>{tag}</Text> : null}
			<Text style={styles.choiceTitle} numberOfLines={2}>
				{title}
			</Text>
		</Pressable>
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
	headerTitle: {
		fontSize: 17,
		fontFamily: fonts.bold,
		color: colors.text,
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	form: {
		padding: 16,
		gap: 12,
	},
	photoPicker: {
		aspectRatio: 1,
		borderRadius: radius.md,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: colors.muted,
		backgroundColor: colors.card,
		alignItems: "center",
		justifyContent: "center",
		overflow: "hidden",
	},
	photoPickerText: {
		fontSize: 16,
		fontFamily: fonts.medium,
		color: colors.muted,
	},
	photoPreview: {
		width: "100%",
		height: "100%",
	},
	input: {
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: 12,
		paddingVertical: 11,
		fontSize: 16,
		fontFamily: fonts.regular,
		color: colors.text,
	},
	noteInput: {
		minHeight: 80,
		textAlignVertical: "top",
	},
	label: {
		fontSize: 15,
		fontFamily: fonts.semibold,
		color: colors.text,
		marginTop: 4,
	},
	buckets: {
		flexDirection: "row",
		gap: 8,
	},
	bucket: {
		flex: 1,
		alignItems: "center",
		paddingVertical: 12,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		gap: 4,
	},
	bucketSelected: {
		borderColor: colors.primary,
		backgroundColor: colors.card,
	},
	bucketImage: {
		width: 56,
		height: 56,
	},
	bucketLabel: {
		fontSize: 13,
		fontFamily: fonts.medium,
		color: colors.text,
	},
	primaryButton: {
		backgroundColor: colors.primary,
		borderRadius: radius.md,
		paddingVertical: 14,
		alignItems: "center",
		marginTop: 8,
	},
	primaryButtonText: {
		color: colors.primaryText,
		fontSize: 16,
		fontFamily: fonts.semibold,
	},
	compare: {
		flex: 1,
		padding: 16,
		justifyContent: "center",
		gap: 24,
	},
	choices: {
		flexDirection: "row",
		gap: 12,
	},
	choice: {
		flex: 1,
		backgroundColor: colors.card,
		borderRadius: radius.lg,
		overflow: "hidden",
		borderWidth: 1,
		borderColor: colors.border,
	},
	choicePhoto: {
		width: "100%",
		aspectRatio: 1,
	},
	choiceNoPhoto: {
		alignItems: "center",
		justifyContent: "center",
	},
	choiceNailong: {
		width: 64,
		height: 64,
		borderRadius: 32,
	},
	choiceTag: {
		position: "absolute",
		top: 10,
		left: 10,
		backgroundColor: colors.primary,
		color: colors.primaryText,
		fontSize: 12,
		fontFamily: fonts.bold,
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: radius.md,
		overflow: "hidden",
	},
	existing: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		padding: 12,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
	},
	existingPhoto: {
		width: 72,
		height: 72,
		borderRadius: radius.md,
	},
	existingTitle: {
		fontSize: 17,
		fontFamily: fonts.bold,
		color: colors.text,
	},
	existingMeta: {
		fontSize: 14,
		fontFamily: fonts.regular,
		color: colors.muted,
		marginTop: 2,
	},
	choiceTitle: {
		padding: 12,
		fontSize: 16,
		fontFamily: fonts.semibold,
		color: colors.text,
	},
	sameAs: {
		fontSize: 14,
		fontFamily: fonts.semibold,
		color: colors.primary,
	},
	secondaryButton: {
		alignSelf: "center",
		paddingVertical: 10,
		paddingHorizontal: 20,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
	},
	secondaryButtonText: {
		fontSize: 15,
		fontFamily: fonts.medium,
		color: colors.text,
	},
});
