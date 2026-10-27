import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { photoAspect, photoUrl, ratingBy, type Recipe } from "../lib/api";
import type { Group } from "../lib/dupes";
import { colors, fonts, radius } from "../lib/theme";
import ScoreBadge from "./ScoreBadge";

const TITLE_LINE = 19;
const TITLE_LINES = 3;

// About how tall a card will be, so the grid can drop each card into the shorter column.
export function gridCardHeight({ key }: Group, width: number) {
	// Inter semibold at 14px averages about 7px a character.
	const charsPerLine = Math.max(1, Math.floor(width / 7));
	const lines = Math.min(TITLE_LINES, Math.ceil(key.title.length / charsPerLine));
	return width / photoAspect(key) + 8 + lines * TITLE_LINE + 6 + 24 + styles.card.marginBottom;
}

// A Pinterest-style tile for the two-column grid: photo at its real shape, name and both scores.
// Tapping opens the full card; ••• or a long press opens the menu.
export default function GridCard({
	group: { key, others },
	people,
	width,
	place,
	onPress,
	onMenu,
}: {
	group: Group;
	people: string[];
	width: number;
	place?: number;
	onPress: () => void;
	onMenu: (recipe: Recipe) => void;
}) {
	return (
		<Pressable
			style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.8 }]}
			onPress={onPress}
			onLongPress={() => onMenu(key)}
			delayLongPress={400}
		>
			<View style={styles.photoFrame}>
				{key.photo ? (
					<Image source={{ uri: photoUrl(key.photo) }} style={{ width, aspectRatio: photoAspect(key) }} />
				) : (
					<View style={[styles.noPhoto, { width }]}>
						<Image source={require("../assets/nailong.jpg")} style={styles.noPhotoImage} />
					</View>
				)}
				{place ? <Text style={styles.place}>#{place}</Text> : null}
				{key.score !== null ? (
					<View style={styles.badge}>
						<ScoreBadge score={key.score} size={34} />
					</View>
				) : null}
				{others.length > 0 ? <Text style={styles.cooked}>cooked {others.length + 1}×</Text> : null}
				{key.only_me ? <Text style={styles.onlyMe}>🔒</Text> : null}
			</View>

			<Text style={styles.title} numberOfLines={TITLE_LINES}>
				{key.title}
			</Text>

			<View style={styles.footer}>
				{people.map((name) => {
					const rating = ratingBy(key, name);
					return (
						<View key={name} style={styles.rating}>
							<Text style={styles.ratingName}>{name[0]?.toLowerCase()}</Text>
							{rating ? <ScoreBadge score={rating.score} size={22} /> : <Text style={styles.unrated}>–</Text>}
						</View>
					);
				})}
				<Pressable onPress={() => onMenu(key)} hitSlop={12} style={({ pressed }) => [styles.menu, pressed && { opacity: 0.5 }]}>
					<Text style={styles.menuText}>•••</Text>
				</Pressable>
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	card: {
		marginBottom: 20,
		gap: 6,
	},
	photoFrame: {
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: "hidden",
	},
	noPhoto: {
		aspectRatio: 1,
		backgroundColor: colors.card,
		alignItems: "center",
		justifyContent: "center",
	},
	noPhotoImage: {
		width: 56,
		height: 56,
		borderRadius: 28,
		opacity: 0.8,
	},
	place: {
		position: "absolute",
		top: 8,
		left: 8,
		backgroundColor: colors.background,
		color: colors.text,
		fontFamily: fonts.bold,
		fontSize: 13,
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: radius.md,
		overflow: "hidden",
	},
	badge: {
		position: "absolute",
		top: 8,
		right: 8,
	},
	cooked: {
		position: "absolute",
		bottom: 8,
		left: 8,
		backgroundColor: colors.background,
		color: colors.text,
		fontFamily: fonts.semibold,
		fontSize: 12,
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: radius.md,
		overflow: "hidden",
	},
	onlyMe: {
		position: "absolute",
		bottom: 8,
		right: 8,
		backgroundColor: colors.background,
		fontSize: 12,
		paddingHorizontal: 6,
		paddingVertical: 3,
		borderRadius: radius.md,
		overflow: "hidden",
	},
	title: {
		marginTop: 2,
		fontSize: 14,
		lineHeight: TITLE_LINE,
		fontFamily: fonts.semibold,
		color: colors.text,
	},
	footer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
	},
	rating: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
	},
	ratingName: {
		fontSize: 13,
		fontFamily: fonts.medium,
		color: colors.muted,
	},
	unrated: {
		width: 22,
		textAlign: "center",
		fontSize: 13,
		fontFamily: fonts.medium,
		color: colors.muted,
	},
	menu: {
		marginLeft: "auto",
	},
	menuText: {
		fontSize: 13,
		letterSpacing: 1,
		color: colors.muted,
	},
});
