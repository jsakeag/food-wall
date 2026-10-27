import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { photoAspect, photoUrl, ratingBy, type Recipe } from "../lib/api";
import { colors, fonts, radius, timeAgo } from "../lib/theme";
import RecipeRow from "./RecipeRow";
import ScoreBadge from "./ScoreBadge";

// Same layout as a food-gallery post: bordered photo, then the details underneath.
// The badge is the average; each person's own score sits under the title.
// For a dish cooked more than once, `recipe` is its best-rated cook and tapping shows the `others`.
export default function RecipeCard({
	recipe,
	others,
	people,
	person,
	place,
	onRate,
	onMenu,
	onOpen,
	defaultExpanded = false,
}: {
	recipe: Recipe;
	others: Recipe[];
	people: string[];
	person: string;
	place?: number;
	onRate: () => void;
	onMenu: (recipe: Recipe) => void;
	// Tapping one of the other cooks shows its own full card.
	onOpen?: (recipe: Recipe) => void;
	defaultExpanded?: boolean;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	return (
		<Pressable
			style={styles.card}
			onPress={others.length > 0 ? () => setExpanded(!expanded) : undefined}
			onLongPress={() => onMenu(recipe)}
			delayLongPress={400}
		>
			<View style={styles.photoFrame}>
				{recipe.photo ? (
					<Image
						source={{ uri: photoUrl(recipe.photo) }}
						style={[styles.photo, { aspectRatio: photoAspect(recipe) }]}
					/>
				) : (
					<View style={[styles.photo, styles.noPhoto]}>
						<Image source={require("../assets/nailong.jpg")} style={styles.noPhotoImage} />
					</View>
				)}
				{place ? <Text style={styles.place}>#{place}</Text> : null}
				{others.length > 0 ? (
					<Text style={styles.cooked}>
						cooked {others.length + 1}× {expanded ? "▴" : "▾"}
					</Text>
				) : null}
				{recipe.score !== null ? (
					<View style={styles.badge}>
						<ScoreBadge score={recipe.score} />
					</View>
				) : null}
			</View>

			<View style={styles.titleRow}>
				<Text style={styles.title}>{recipe.title}</Text>
				<Pressable onPress={() => onMenu(recipe)} hitSlop={12} style={({ pressed }) => pressed && { opacity: 0.5 }}>
					<Text style={styles.menu}>•••</Text>
				</Pressable>
			</View>

			<View style={styles.ratings}>
				{people.map((name) => {
					const rating = ratingBy(recipe, name);
					if (rating) {
						return (
							<View key={name} style={styles.rating}>
								<Text style={styles.ratingName}>@{name}</Text>
								<ScoreBadge score={rating.score} size={26} />
							</View>
						);
					}
					if (name === person) {
						return (
							<Pressable
								key={name}
								style={({ pressed }) => [styles.rateButton, pressed && { opacity: 0.75 }]}
								onPress={onRate}
							>
								<Text style={styles.rateButtonText}>rate it</Text>
							</Pressable>
						);
					}
					return (
						<Text key={name} style={styles.waiting}>
							{`@${name} hasn't rated`}
						</Text>
					);
				})}
			</View>

			<View style={styles.metaRow}>
				<Text style={styles.note}>{recipe.note}</Text>
				<Text style={styles.time}>
					{recipe.only_me ? "🔒 only me · " : ""}
					{timeAgo(recipe.created_at)}
				</Text>
			</View>
			{recipe.source_url ? (
				<Text style={styles.link} onPress={() => Linking.openURL(recipe.source_url!)}>
					view recipe ↗
				</Text>
			) : null}

			{expanded ? (
				<View style={styles.others}>
					{others.map((other) => (
						<RecipeRow
							key={other.id}
							recipe={other}
							onPress={onOpen && (() => onOpen(other))}
							onLongPress={() => onMenu(other)}
						>
							<Pressable onPress={() => onMenu(other)} hitSlop={12}>
								<Text style={styles.menu}>•••</Text>
							</Pressable>
						</RecipeRow>
					))}
				</View>
			) : null}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	card: {
		marginBottom: 32,
		gap: 10,
	},
	photoFrame: {
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: "hidden",
	},
	photo: {
		width: "100%",
		aspectRatio: 1,
	},
	noPhoto: {
		backgroundColor: colors.card,
		alignItems: "center",
		justifyContent: "center",
	},
	noPhotoImage: {
		width: 92,
		height: 92,
		borderRadius: 46,
		opacity: 0.8,
	},
	place: {
		position: "absolute",
		top: 12,
		left: 12,
		backgroundColor: colors.background,
		color: colors.text,
		fontFamily: fonts.bold,
		fontSize: 15,
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: radius.md,
		overflow: "hidden",
	},
	cooked: {
		position: "absolute",
		bottom: 12,
		left: 12,
		backgroundColor: colors.background,
		color: colors.text,
		fontFamily: fonts.semibold,
		fontSize: 14,
		paddingHorizontal: 10,
		paddingVertical: 4,
		borderRadius: radius.md,
		overflow: "hidden",
	},
	others: {
		gap: 8,
	},
	badge: {
		position: "absolute",
		top: 12,
		right: 12,
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
	},
	menu: {
		fontSize: 14,
		letterSpacing: 1,
		color: colors.muted,
	},
	title: {
		flex: 1,
		fontSize: 17,
		fontFamily: fonts.bold,
		color: colors.text,
	},
	ratings: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		gap: 16,
	},
	rating: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	ratingName: {
		fontSize: 14,
		fontFamily: fonts.medium,
		color: colors.muted,
	},
	rateButton: {
		backgroundColor: colors.primary,
		borderRadius: radius.md,
		paddingHorizontal: 12,
		paddingVertical: 5,
	},
	rateButtonText: {
		color: colors.primaryText,
		fontSize: 14,
		fontFamily: fonts.semibold,
	},
	waiting: {
		fontSize: 14,
		fontFamily: fonts.regular,
		color: "#64748B",
	},
	metaRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
	},
	note: {
		flex: 1,
		fontSize: 14,
		fontFamily: fonts.regular,
		color: colors.muted,
	},
	time: {
		fontSize: 14,
		fontFamily: fonts.regular,
		color: "#64748B",
	},
	link: {
		fontSize: 14,
		fontFamily: fonts.semibold,
		color: colors.primary,
	},
});
