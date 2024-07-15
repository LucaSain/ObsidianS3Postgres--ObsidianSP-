import DB from "db/db";
import {
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
	Vault,
} from "obsidian";
import { SampleSettingTab } from "SampleSettingTab";
export interface Settings {
	POSTGRES_HOST: string;
	POSTGRES_PORT: string;
	POSTGRES_DATABASE: string;
	POSTGRES_USERNAME: string;
	POSTGRES_PASSWORD: string;
	S3_URL: string;
	S3_ACCESS_KEY: string;
	S3_SECRET_KEY: string;
	S3_PORT: string;
	S3_BUCKET: string;
	S3_SSL: string;
}

const DEFAULT_SETTINGS: Settings = {
	POSTGRES_HOST: "",
	POSTGRES_PORT: "5432",
	POSTGRES_DATABASE: "",
	POSTGRES_USERNAME: "",
	POSTGRES_PASSWORD: "",
	S3_URL: "",
	S3_ACCESS_KEY: "",
	S3_SECRET_KEY: "",
	S3_PORT: "9000",
	S3_BUCKET: "",
	S3_SSL: "true",
};

export default class Obsidian2Cloud extends Plugin {
	settings: Settings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SampleSettingTab(this.app, this));

		const db = new DB({
			vault: this.app.vault,
			settings: this.settings,
		});
		await db.init();

		this.app.vault.on("create", async (file) => {
			await db.create(file);
		});

		this.app.vault.on("delete", async (file) => {
			await db.remove(file);
		});

		this.app.vault.on("rename", async (file, oldPath) => {
			await db.rename(file, oldPath);
		});

		this.app.vault.on("modify", async (file) => {
			await db.modify(file);
		});

		this.addCommand({
			id: "push-to-s3",
			name: "Push images from images to s3",
			callback: async () => {
				const images = this.app.vault.getFolderByPath("images");
				if (images !== null) {
					{
						for (const imageFile of images.children) {
							await db.create(imageFile);
							new Notice("Image uploaded successfully");
						}
					}
				} else {
					new Notice("No images folder found");
				}
			},
		});

		this.addCommand({
			id: "push-markdown",
			name: "Push markdown to database",
			callback: async () => {
				const files = this.app.vault.getFiles();
				for (const file of files) {
					await db.create(file);
				}
			},
		});
	}

	async onunload() {
		console.log("unloading plugin");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
