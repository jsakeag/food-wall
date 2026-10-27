import * as SecureStore from "expo-secure-store";
import { Alert, Platform } from "react-native";

// Small wrappers so the same code runs as the iPhone app and the home-screen web app.

export const isWeb = Platform.OS === "web";

export const storage = {
	async get(key: string): Promise<string | null> {
		if (!isWeb) return SecureStore.getItemAsync(key);
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	async set(key: string, value: string) {
		if (!isWeb) return SecureStore.setItemAsync(key, value);
		try {
			localStorage.setItem(key, value);
		} catch {}
	},
	async remove(key: string) {
		if (!isWeb) return SecureStore.deleteItemAsync(key);
		try {
			localStorage.removeItem(key);
		} catch {}
	},
};

// react-native-web's Alert does nothing, so the browser's own dialogs stand in there.
export function notify(title: string, message?: string) {
	if (isWeb) window.alert(message ? `${title}\n\n${message}` : title);
	else Alert.alert(title, message);
}

export function confirm(title: string, message: string, confirmLabel: string, destructive = false) {
	if (isWeb) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
	return new Promise<boolean>((resolve) =>
		Alert.alert(
			title,
			message,
			[
				{ text: "cancel", style: "cancel", onPress: () => resolve(false) },
				{ text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
			],
			{ cancelable: true, onDismiss: () => resolve(false) },
		),
	);
}
