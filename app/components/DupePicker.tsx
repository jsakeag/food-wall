import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Recipe } from "../lib/api";
import { likelyDupes } from "../lib/dupes";
import { colors, fonts, radius } from "../lib/theme";
import RecipeRow from "./RecipeRow";

// Picks which recipe `recipe` is a dupe of: likely matches first, then everything else.
export default function DupePicker({
	recipe,
	recipes,
	onClose,
	onPick,
}: {
	recipe: Recipe | null;
	recipes: Recipe[];
	onClose: () => void;
	onPick: (dupeOf: Recipe) => void;
}) {
	const [query, setQuery] = useState("");
	const choices = recipe ? recipes.filter((r) => r.group_id !== recipe.group_id) : [];
	const suggested = recipe ? likelyDupes(recipe.title, choices) : [];
	const rest = choices.filter((r) => !suggested.includes(r));
	const matching = [...suggested, ...rest].filter((r) => r.title.toLowerCase().includes(query.trim().toLowerCase()));

	return (
		<Modal visible={recipe !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
			<View style={styles.sheet}>
				<View style={styles.header}>
					<Pressable onPress={onClose} hitSlop={12}>
						<Text style={styles.headerButton}>cancel</Text>
					</Pressable>
					<Text style={styles.headerTitle}>mark dupe</Text>
					<View style={{ width: 56 }} />
				</View>
				<FlatList
					data={matching}
					keyExtractor={(r) => r.id}
					contentContainerStyle={styles.list}
					keyboardShouldPersistTaps="handled"
					ListHeaderComponent={
						<View style={styles.top}>
							<Text style={styles.label} numberOfLines={2}>
								{`"${recipe?.title}" is the same dish as…`}
							</Text>
							<TextInput
								style={styles.input}
								placeholder="search"
								placeholderTextColor={colors.muted}
								keyboardAppearance="dark"
								value={query}
								onChangeText={setQuery}
								autoCorrect={false}
							/>
						</View>
					}
					ListEmptyComponent={<Text style={styles.empty}>nothing matches</Text>}
					renderItem={({ item }) => <RecipeRow recipe={item} onPress={() => onPick(item)} />}
				/>
			</View>
		</Modal>
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
	list: {
		padding: 16,
		gap: 8,
	},
	top: {
		gap: 12,
		marginBottom: 4,
	},
	label: {
		fontSize: 15,
		fontFamily: fonts.semibold,
		color: colors.text,
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
	empty: {
		textAlign: "center",
		color: colors.muted,
		fontSize: 15,
		fontFamily: fonts.regular,
		marginTop: 24,
	},
});
