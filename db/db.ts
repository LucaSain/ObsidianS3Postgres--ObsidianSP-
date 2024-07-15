import { Client } from "minio";
import { TFile, TAbstractFile, TFolder, Vault, Notice } from "obsidian";
import { PostgresType } from "postgres";

interface Settings {
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

export default class Database {
	private s3: { client?: Client; bucket: string; baseUrl: string };
	private sql: any;
	private vault: Vault;
	private settings: Settings;
	constructor({ vault, settings }: { vault: Vault; settings: Settings }) {
		this.settings = settings;
		this.vault = vault;
	}

	init = async () => {
		this.s3 = { client: undefined, bucket: "", baseUrl: "" };
		try {
			this.sql = await require("postgres")(
				"postgres://username:password@host:port/database",
				{
					host: this.settings.POSTGRES_HOST,
					port: this.settings.POSTGRES_PORT,
					database: this.settings.POSTGRES_DATABASE,
					username: this.settings.POSTGRES_USERNAME,
					password: this.settings.POSTGRES_PASSWORD,
				}
			);
			this.s3.client = new (require("minio").Client)({
				endPoint: this.settings.S3_URL,
				accessKey: this.settings.S3_ACCESS_KEY,
				secretKey: this.settings.S3_SECRET_KEY,
				useSSL: this.settings.S3_SSL === "true" ? true : false,
				port: parseInt(this.settings.S3_PORT),
			});
		} catch (e) {
			console.log(e);
			new Notice(
				"The database could not be initialized. Please check the settings"
			);
		}

		this.s3.bucket = this.settings.S3_BUCKET;
		this.s3.baseUrl =
			"https://" +
			this.settings.S3_URL +
			":" +
			this.settings.S3_PORT +
			"/" +
			this.settings.S3_BUCKET +
			"/";

		await this.sql`CREATE TABLE IF NOT EXISTS node (
			 id SERIAL PRIMARY KEY,
			  parent_id INTEGER REFERENCES node(id) ON DELETE CASCADE,
			  data TEXT,
			UNIQUE (parent_id, data)
		);`;
		console.log(this.s3);

		const exists = await this.sql`SELECT id FROM node WHERE data = 'root'`;
		if (exists.length === 0)
			await this.sql`INSERT INTO node (data) VALUES ('root')`;
	};
	findNode = async (data: string, parent: number) => {
		const res = await this
			.sql`SELECT id FROM node WHERE parent_id = ${parent} AND data = ${data}`;
		if (res.length === 0) return undefined;
		return res[0].id;
	};

	insertNode = async (data: string, parent: number) => {
		let res = await this
			.sql`INSERT INTO node (parent_id, data) VALUES (${parent}, ${data}) ON CONFLICT (parent_id, data) DO NOTHING RETURNING id`;
		if (res.length === 0) {
			return await this.findNode(data, parent);
		}
		return res[0].id;
	};

	findLeaf = async (id: number) => {
		const res = await this.sql`SELECT id FROM node WHERE parent_id = ${id}`;
		return res[0].id;
	};

	findChild = async (id: number, data: string) => {
		const res = await this
			.sql`SELECT id FROM node WHERE parent_id = ${id} AND data = ${data}`;
		return res[0].id;
	};

	updateNode = async (id: number, data: string, parent: number) => {
		const res = await this
			.sql`UPDATE node SET data = ${data}, parent_id = ${parent} 
			WHERE id = ${id}
			RETURNING id`;
		return res[0].id;
	};
	deleteNode = async (id: number) => {
		await this.sql`DELETE FROM node WHERE id = ${id}`;
	};

	_find_id_by_file = async (file: TFile | TAbstractFile | TFolder | null) => {
		if (file === null || file.path == "/") {
			return 1;
		}
		const parentId = await this._find_id_by_file(file.parent);
		const id = await this.findNode(file.name, parentId);
		return id;
	};

	_find_id_by_path = async (path: string) => {
		const parentPath = path.split("/").slice(0, -1).join("/");
		const parent = (await this.vault.getFolderByPath(
			parentPath
		)) as TFolder;

		const parentId = await this.pushFile(parent); //recursively creates folders
		const fileName = path.split("/").pop() as string;
		const id = await this.findChild(parentId, fileName);

		return id;
	};

	getId = async ({
		path,
		file,
	}: {
		path?: string;
		file?: TFile | TAbstractFile | TFolder | null;
	}) => {
		if (file) {
			return await this._find_id_by_file(file);
		} else if (path) {
			return await this._find_id_by_path(path);
		}
		return -1;
	};

	pushFile = async (file: TFile | TAbstractFile | TFolder) => {
		if (file === null || file.parent === null) {
			return 1;
		}

		const parentId = await this.pushFile(file.parent);
		const id = await this.insertNode(file.name, parentId);

		if (!(file instanceof TFolder)) {
			await this.pushToBucket(file, id);
			const data = id + ".md";

			await this.insertNode(data, id);
		}
		return id;
	};

	//function to replace the markdown links for svgs, from the folder images
	//with their link to the minio bucket

	processImageLinks(data: string) {
		const regex = /!\[\]\((.+?excalidraw\.svg)\)/g;
		const regexComm = /\%\%.+?\%\%/g;

		const processed = data.replace(
			regex,
			(match, g1) => `![](${this.s3.baseUrl}${g1})`
		);
		const processedComm = processed.replace(regexComm, (match) => "");
		return processedComm;
	}
	isExcalidraw = (file: TFile | TAbstractFile) => {
		return file.name.search(/\.excalidraw\.md$/) != -1;
	};

	isImage = (file: TFile | TAbstractFile) => {
		return (
			file.path.includes("images") &&
			file.name.search(/\.excalidraw\.md$/) === -1
		);
	};

	fileMoved = (file: TFile | TAbstractFile, oldPath: string) => {
		const oldParent = oldPath.split("/").slice(0, -1).join("/");
		const newParent = file.path.split("/").slice(0, -1).join("/");
		return oldParent !== newParent;
	};

	_handleMoveFile = async (file: TFile | TAbstractFile, oldPath: string) => {
		const id = await this.getId({ path: oldPath });
		await this.deleteNode(id);
		await this.pushFile(file);
	};
	_handleRenameFile = async (
		file: TFile | TAbstractFile,
		oldPath: string
	) => {
		const id = await this.getId({ path: oldPath });
		let parentId = 1;
		if (file.parent && file.parent.parent)
			parentId = await this.getId({ file: file.parent });
		await this.updateNode(id, file.name, parentId);
	};
	pushToBucket = async (file: TFile | TAbstractFile, id = 0) => {
		if (id === 0) {
			//@ts-ignore
			const absolutePath = this.vault.adapter.basePath;
			const metaData = {
				"Content-Type": "image/svg+xml",
				"X-Amz-Meta-Testing": 1234,
			};

			await this.s3.client?.fPutObject(
				this.s3.bucket,
				file.name,
				absolutePath + "/" + file.path,
				metaData
			);
		} else {
			const data = await this.vault.read(file as TFile);
			const processed = this.processImageLinks(data);
			await this.s3.client?.putObject(
				this.s3.bucket,
				id + ".md",
				processed
			);
		}
	};
	deleteFromBucket = async (fileName: string, id = 0) => {
		if (id === 0) {
			await this.s3.client?.removeObject(
				this.s3.bucket,
				"images/" + fileName
			);
		} else {
			console.log("deleting from bucket", id);
			await this.s3.client?.removeObject(this.s3.bucket, id + ".md");
		}
	};

	async remove(file: TAbstractFile) {
		try {
			const id = await this.getId({ file });

			if (id === -1) {
				return;
			}
			if (this.isImage(file)) {
				await this.deleteFromBucket(file.name);
			} else if (!this.isExcalidraw(file)) {
				await this.deleteNode(id);
				await this.deleteFromBucket(file.name, id);
			}
		} catch (e) {
			console.log("file already deleted");
		}
	}

	async modify(file: TAbstractFile) {
		if (this.isImage(file)) {
			await this.deleteFromBucket(file.name);
			await this.pushToBucket(file);
		} else if (!this.isExcalidraw(file)) {
			await this.handleModifyFile(file);
		}
	}

	async rename(file: TAbstractFile, oldPath: string) {
		if (this.isImage(file)) {
			await this.deleteFromBucket(file.name);
			await this.pushToBucket(file);
		} else if (!this.isExcalidraw(file)) {
			if (this.fileMoved(file, oldPath)) {
				await this._handleMoveFile(file, oldPath);
			} else {
				await this._handleRenameFile(file, oldPath);
			}
		}
	}

	async create(file: TAbstractFile) {
		if (this.isImage(file)) {
			await this.pushToBucket(file);
		} else if (!this.isExcalidraw(file)) {
			await this.pushFile(file);
		}
	}

	private async handleModifyFile(file: TAbstractFile) {
		const id = await this.getId({ file });
		await this.deleteFromBucket(file.name, id);
		await this.pushToBucket(file, id);
	}
}
