"use client";
import React, { useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

import Uppy from "@uppy/core";
import { Dashboard } from "@uppy/react";

import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import { Button } from "./ui/button";
import Tus from "@uppy/tus";
import useUser from "@/app/hook/useUser";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Input } from "./ui/input";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function Uploader() {
	const inputRef = useRef() as React.MutableRefObject<HTMLInputElement>;
	const { data: user } = useUser();
	const supabase = supabaseBrowser();
	const router = useRouter();

	function sanitizeFilename(filename: string): string {
		const name = filename.substring(0, filename.lastIndexOf('.'));
		const extension = filename.substring(filename.lastIndexOf('.'));
		
		const sanitizedName = name
			.replace(/\s+/g, '_')            // Replace spaces with underscores
			.replace(/[^a-zA-Z0-9_-]/g, '')  // Remove special characters except _ and -
			.replace(/_{2,}/g, '_')          // Replace multiple underscores with single
			.replace(/^_+|_+$/g, '');       // Remove leading/trailing underscores
		
		return sanitizedName + extension;
	}

	const onBeforeRequest = async (req: any) => {
		const { data } = await supabase.auth.getSession();
		req.setHeader("Authorization", `Bearer ${data.session?.access_token}`);
	};
	const [uppy] = useState(() =>
		new Uppy({
			restrictions: {
				maxNumberOfFiles: 1,
				allowedFileTypes: ["image/*"],
				maxFileSize: 5 * 1000 * 1000,
			},
		}).use(Tus, {
			endpoint:
				process.env.NEXT_PUBLIC_SUPABASE_URL +
				"/storage/v1/upload/resumable",
			onBeforeRequest,
			allowedMetaFields: [
				"bucketName",
				"objectName",
				"contentType",
				"cacheControl",
				"metadata",
			],
		})
	);

	uppy.on("file-added", (file) => {
		file.meta = {
			...file.meta,
			bucketName: "images",
			contentType: file.type,
		};
	});

	uppy.on("upload-success", () => {
		uppy.cancelAll();
		if (inputRef.current) {
			inputRef.current.value = "";
		}
		document.getElementById("trigger-close")?.click();
		router.refresh();
	});

	const handleUpload = () => {
		if (uppy.getFiles().length !== 0) {
			const randomUUID = crypto.randomUUID();
			const currentDescription = inputRef.current.value;

			uppy.setFileMeta(uppy.getFiles()[0].id, {
				// Supabase splits objectName by "/" to get path tokens
				objectName:
					user?.id + "/" + randomUUID + "/" + sanitizeFilename(uppy.getFiles()[0].name),
				metadata: JSON.stringify({ // custom metadata passed to the user_metadata column
					desc: currentDescription,
                }),
			});

			uppy.upload().then(() => {
				// No need for additional database update since trigger handles it
				toast.success("Upload completed successfully!");
			}).catch((error) => {
				toast.error("Upload failed");
				console.error(error);
			});
		} else {
			toast.warning("Please adding an image");
		}
	};

	return (
		<Dialog>
			<DialogTrigger asChild>
				<button id="upload-trigger"></button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Daily Upload</DialogTitle>
					<DialogDescription>Select your photo.</DialogDescription>
				</DialogHeader>
				<div className=" space-y-5">
					<Dashboard
						uppy={uppy}
						className="w-auto"
						hideUploadButton
					/>
					<Input placeholder=" image description" ref={inputRef} />
					<Button className="w-full" onClick={handleUpload}>
						Upload
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
