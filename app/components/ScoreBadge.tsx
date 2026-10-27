import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../lib/theme";

export default function ScoreBadge({ score, size = 44 }: { score: number; size?: number }) {
	const background = score >= 7 ? colors.good : score >= 4 ? colors.okay : colors.bad;
	return (
		<View
			style={[
				styles.badge,
				{ width: size, height: size, borderRadius: size / 2, backgroundColor: background },
			]}
		>
			<Text style={[styles.text, { fontSize: size * 0.36 }]}>{score.toFixed(1)}</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	badge: {
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 2,
		borderColor: colors.background,
	},
	text: {
		color: colors.background,
		fontFamily: fonts.bold,
	},
});
