import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { photoUrl, type Recipe } from "../lib/api";
import { colors, fonts, radius, timeAgo } from "../lib/theme";
import ScoreBadge from "./ScoreBadge";

// A compact one-line recipe: thumbnail, name, who logged it and when, and its score.
export default function RecipeRow({
	recipe,
	onPress,
	onLongPress,
	children,
}: {
	recipe: Recipe;
	onPress?: () => void;
	onLongPress?: () => void;
	// Extra controls at the end of the row (e.g. a ••• button).
	children?: ReactNode;
}) {
	return (
		<Pressable
			style={({ pressed }) => [styles.row, pressed && onPress && { opacity: 0.7 }]}
			onPress={onPress}
			onLongPress={onLongPress}
			delayLongPress={400}
		>
			<Image
				source={recipe.photo ? { uri: photoUrl(recipe.photo) } : require("../assets/nailong.jpg")}
				style={styles.photo}
			/>
			<View style={styles.details}>
				<Text style={styles.title} numberOfLines={2}>
					{recipe.title}
				</Text>
				<Text style={styles.meta}>
					@{recipe.created_by} · {timeAgo(recipe.created_at)}
				</Text>
			</View>
			{recipe.score !== null ? <ScoreBadge score={recipe.score} size={32} /> : null}
			{children}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	row: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		padding: 10,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
	},
	photo: {
		width: 56,
		height: 56,
		borderRadius: radius.md,
	},
	details: {
		flex: 1,
		gap: 2,
	},
	title: {
		fontSize: 15,
		fontFamily: fonts.semibold,
		color: colors.text,
	},
	meta: {
		fontSize: 13,
		fontFamily: fonts.regular,
		color: colors.muted,
	},
});
