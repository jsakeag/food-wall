import Uploader from "@/components/Uploader";
import { supabaseServer } from "@/lib/supabase/server";
import React from "react";
import Image from "next/image";
import DeletePost from "@/components/DeletePost";

export default async function page() {
	const supabase = supabaseServer();

	const { data } = await supabase
		.from("posts")
		.select("*,profiles(display_name)")
		.order("created_at", { ascending: false });
	const imgeUrlHost =
		"https://vlerrqzskxttyldnqfbe.supabase.co/storage/v1/object/public/images/";

	const posts = data?.map((post) => {
		return {
			image: `${post.post_by}/${post.id}/${post.name}`,
			...post,
		};
	});

	function getTimeAgo(dateString: string): string {
		const now = new Date();
		const past = new Date(dateString);
		const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);
		
		if (diffInSeconds < 60) return `${diffInSeconds}s`;
		if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
		if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
		if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`;
		return `${Math.floor(diffInSeconds / 604800)}w`;
	}

	return (
		<div>
			<div className="grid grid-cols-3 gap-10">
				{posts?.map((post) => {
					return (
						<div
							key={post.id}
							className=" rounded-md w-full space-y-5 relative group"
						>
							<div className="w-full h-96 relative rounded-md border">
								<Image
									src={imgeUrlHost + post.image}
									alt={post.description || ""}
									fill
									className=" rounded-md object-cover object-center"
								/>
							</div>
							<div className="flex flex-wrap items-start gap-3 text-sm">
								<h1 className="font-medium">@{post.profiles?.display_name}</h1>
								<p className="text-gray-600 flex-1 min-w-0 break-words">{post.description}</p>
								<p className="text-gray-400 whitespace-nowrap">
									{getTimeAgo(post.created_at)}
								</p>
								<div className="opacity-0 group-hover:opacity-100 transition-opacity">
									<DeletePost
										post_by={post.post_by}
										image={post.image}
									/>
								</div>
							</div>
						</div>
					);
				})}
			</div>
			<Uploader />
		</div>
	);
}
