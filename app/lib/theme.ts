import type { ImageSourcePropType } from "react-native";
import type { Bucket } from "./api";

// food-gallery's "nailong kitchen" look: shadcn's dark slate palette.
export const colors = {
	background: "#020817",
	card: "#0F172A",
	text: "#F8FAFC",
	muted: "#94A3B8",
	border: "#1E293B",
	primary: "#3B82F6",
	primaryText: "#0F172A",
	good: "#22C55E",
	okay: "#EAB308",
	bad: "#EF4444",
};

export const fonts = {
	regular: "Inter_400Regular",
	medium: "Inter_500Medium",
	semibold: "Inter_600SemiBold",
	bold: "Inter_700Bold",
};

export const radius = {
	lg: 8,
	md: 6,
};

// The auth page's glowBox: white core, magenta then cyan halo.
export const glow = "0 0 60px 30px #fff, 0 0 100px 60px #f0f, 0 0 140px 90px #0ff";

export const BUCKETS: { value: Bucket; label: string; image: ImageSourcePropType }[] = [
	{ value: "loved", label: "loved it", image: require("../assets/nailong_good.png") },
	{ value: "fine", label: "it was fine", image: require("../assets/nailong_okay.png") },
	{ value: "disliked", label: "didn't like it", image: require("../assets/nailong_bad.png") },
];

export function timeAgo(dateString: string) {
	const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
	if (seconds < 60) return `${Math.max(seconds, 0)}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
	return `${Math.floor(seconds / 604800)}w`;
}
