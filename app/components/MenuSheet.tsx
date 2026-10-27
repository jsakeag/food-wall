import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isWeb } from "../lib/platform";
import { colors, fonts, radius } from "../lib/theme";

export type MenuAction = { label: string; onPress: () => void; destructive?: boolean };

// A bottom action sheet that works on iPhone and on the web (where ActionSheetIOS doesn't exist).
export default function MenuSheet({
	title,
	actions,
	onClose,
}: {
	title: string;
	actions: MenuAction[] | null;
	onClose: () => void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<Modal visible={actions !== null} transparent animationType="fade" onRequestClose={onClose}>
			<Pressable style={styles.backdrop} onPress={onClose}>
				<View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
					<Text style={styles.title} numberOfLines={1}>
						{title}
					</Text>
					{actions?.map((action) => (
						<Pressable
							key={action.label}
							style={({ pressed }) => [styles.option, pressed && styles.pressed]}
							onPress={() => {
								onClose();
								// iOS can't present the next sheet/alert until this one has finished closing.
								setTimeout(action.onPress, isWeb ? 0 : 350);
							}}
						>
							<Text style={[styles.optionText, action.destructive && { color: colors.bad }]}>
								{action.label}
							</Text>
						</Pressable>
					))}
					<Pressable style={({ pressed }) => [styles.cancel, pressed && styles.pressed]} onPress={onClose}>
						<Text style={styles.optionText}>cancel</Text>
					</Pressable>
				</View>
			</Pressable>
		</Modal>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		justifyContent: "flex-end",
		backgroundColor: "rgba(0, 0, 0, 0.6)",
	},
	sheet: {
		backgroundColor: colors.card,
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
		borderWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: 16,
		paddingTop: 16,
		gap: 8,
	},
	title: {
		fontSize: 14,
		fontFamily: fonts.medium,
		color: colors.muted,
		textAlign: "center",
		marginBottom: 4,
	},
	option: {
		paddingVertical: 14,
		alignItems: "center",
		borderRadius: radius.md,
		backgroundColor: colors.background,
	},
	cancel: {
		paddingVertical: 14,
		alignItems: "center",
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		marginTop: 4,
	},
	optionText: {
		fontSize: 16,
		fontFamily: fonts.semibold,
		color: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
});
