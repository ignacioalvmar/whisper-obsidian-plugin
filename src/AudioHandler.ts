import axios from "axios";
import type Whisper from "main";
import { Notice, MarkdownView } from "obsidian";
import {
	getBaseFileName,
	getCursorContext,
	buildTemplateVariables,
	resolveTemplate,
} from "./utils";
import { PostProcessor } from "./PostProcessor";

const MIN_AUDIO_SIZE_BYTES = 1000;

export class AudioHandler {
	private plugin: Whisper;

	constructor(plugin: Whisper) {
		this.plugin = plugin;
	}

	private getPostProcessingApiKey(): string {
		switch (this.plugin.settings.postProcessingProvider) {
			case "anthropic":
				return this.plugin.settings.anthropicApiKey;
			case "openai":
				return this.plugin.settings.openAiApiKey;
			case "custom":
				return this.plugin.settings.postProcessingApiKey;
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (
			folderPath &&
			!(await this.plugin.app.vault.adapter.exists(folderPath))
		) {
			await this.plugin.app.vault.createFolder(folderPath);
		}
	}

	private getAudioFilePath(fileName: string): string {
		return `${
			this.plugin.settings.audioSavePath
				? `${this.plugin.settings.audioSavePath}/`
				: ""
		}${fileName}`;
	}

	private getChunkFileName(
		fileName: string,
		chunkIndex: number,
		chunkCount: number
	): string {
		if (chunkCount === 1) {
			return fileName;
		}

		const dotIndex = fileName.lastIndexOf(".");
		const baseName =
			dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
		const extension = dotIndex > 0 ? fileName.substring(dotIndex) : "";
		const partNumber = String(chunkIndex + 1).padStart(3, "0");
		return `${baseName}.part-${partNumber}${extension}`;
	}

	private getTranscriptionPrompt(): string {
		let prompt = this.plugin.settings.prompt || "";
		if (this.plugin.settings.cursorContext) {
			const editor =
				this.plugin.app.workspace.getActiveViewOfType(
					MarkdownView
				)?.editor;
			if (editor) {
				const context = getCursorContext(editor);
				prompt = prompt ? `${prompt}\n${context}` : context;
			}
		}
		return prompt;
	}

	private buildTranscriptionFormData(
		blob: Blob,
		fileName: string,
		prompt: string
	): FormData {
		const formData = new FormData();
		formData.append("file", blob, fileName);
		formData.append("model", this.plugin.settings.model);
		if (
			this.plugin.settings.language &&
			this.plugin.settings.language !== "auto"
		) {
			formData.append("language", this.plugin.settings.language);
		}

		if (prompt) formData.append("prompt", prompt);

		if (this.plugin.settings.temperature !== 0)
			formData.append(
				"temperature",
				String(this.plugin.settings.temperature)
			);
		if (this.plugin.settings.responseFormat !== "json")
			formData.append(
				"response_format",
				this.plugin.settings.responseFormat
			);

		return formData;
	}

	private async saveAudioFile(blob: Blob, fileName: string): Promise<string> {
		if (!this.plugin.settings.saveAudioFile) {
			return "";
		}

		const audioFilePath = this.getAudioFilePath(fileName);
		try {
			await this.ensureFolderExists(this.plugin.settings.audioSavePath);
			const arrayBuffer = await blob.arrayBuffer();
			await this.plugin.app.vault.adapter.writeBinary(
				audioFilePath,
				new Uint8Array(arrayBuffer)
			);
		} catch (err) {
			console.error("Error saving audio file:", err);
			new Notice(
				"✘ Couldn't save audio: " +
					(err instanceof Error ? err.message : String(err))
			);
		}
		return audioFilePath;
	}

	private async transcribeAudioChunk(
		blob: Blob,
		fileName: string,
		prompt: string
	): Promise<string> {
		const formData = this.buildTranscriptionFormData(
			blob,
			fileName,
			prompt
		);
		const response = await axios.post(
			this.plugin.settings.apiUrl,
			formData,
			{
				headers: {
					"Content-Type": "multipart/form-data",
					...(this.plugin.settings.apiKey
						? {
								Authorization: `Bearer ${this.plugin.settings.apiKey}`,
						  }
						: {}),
				},
			}
		);

		if (typeof response.data === "string") {
			return response.data;
		}
		return (response.data as { text?: string }).text || "";
	}

	private async postProcessText(
		originalText: string
	): Promise<string | null> {
		if (!this.plugin.settings.postProcessing) {
			return originalText;
		}

		const ppApiKey = this.getPostProcessingApiKey();
		if (!ppApiKey) {
			new Notice("✘ Add your post-processing API key in settings");
			return null;
		}

		try {
			if (this.plugin.settings.debugMode) {
				new Notice("Post-processing...");
			}
			const processor = new PostProcessor({
				apiKey: ppApiKey,
				model: this.plugin.settings.postProcessingModel,
				url: this.plugin.settings.postProcessingUrl,
				provider: this.plugin.settings.postProcessingProvider,
			});
			return await processor.process(
				originalText,
				this.plugin.settings.postProcessingPrompt
			);
		} catch (err) {
			console.error("Post-processing failed:", err);
			new Notice(
				"✘ Post-processing failed, using original transcription"
			);
			return originalText;
		}
	}

	private async generateTitle(
		finalText: string,
		baseFileName: string
	): Promise<string> {
		if (
			!this.plugin.settings.autoGenerateTitle ||
			!this.plugin.settings.createNoteFile
		) {
			return baseFileName;
		}

		const ppApiKey = this.getPostProcessingApiKey();
		if (!ppApiKey) {
			return baseFileName;
		}

		try {
			const processor = new PostProcessor({
				apiKey: ppApiKey,
				model: this.plugin.settings.postProcessingModel,
				url: this.plugin.settings.postProcessingUrl,
				provider: this.plugin.settings.postProcessingProvider,
			});
			const title = await processor.process(
				finalText,
				this.plugin.settings.titleGenerationPrompt
			);
			const sanitizedTitle = title
				.replace(/[/\\?%*:|"<>\n]/g, "-")
				.trim();
			return sanitizedTitle || baseFileName;
		} catch (err) {
			console.error("Title generation failed:", err);
			return baseFileName;
		}
	}

	private async writeTranscriptionOutput(
		originalText: string,
		baseFileName: string,
		audioFilePath: string
	): Promise<boolean> {
		const finalText = await this.postProcessText(originalText);
		if (finalText === null) {
			return false;
		}
		const generatedTitle = await this.generateTitle(
			finalText,
			baseFileName
		);

		const outputText =
			this.plugin.settings.keepOriginalTranscription &&
			finalText !== originalText
				? `${finalText}\n\n---\n\n*Original transcription:*\n${originalText}`
				: finalText;

		if (this.plugin.settings.createNoteFile) {
			await this.ensureFolderExists(this.plugin.settings.noteSavePath);

			const vars = buildTemplateVariables(
				outputText,
				generatedTitle,
				audioFilePath
			);

			const resolvedFilename =
				resolveTemplate(this.plugin.settings.noteFilenameTemplate, vars)
					.replace(/[/\\?%*:|"<>\n]/g, "-")
					.trim() || baseFileName;

			const folder = this.plugin.settings.noteSavePath;
			const resolvedNoteFilePath = `${
				folder ? `${folder}/` : ""
			}${resolvedFilename}.md`;

			const noteContent = resolveTemplate(
				this.plugin.settings.noteTemplate,
				vars
			).trim();

			await this.plugin.app.vault.create(
				resolvedNoteFilePath,
				noteContent
			);
		}

		const editor =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (editor) {
			const cursorPosition = editor.getCursor();
			editor.replaceRange(outputText, cursorPosition);

			const newPosition = {
				line: cursorPosition.line,
				ch: cursorPosition.ch + outputText.length,
			};
			editor.setCursor(newPosition);
		}
		return true;
	}

	async sendAudioData(blob: Blob, fileName: string): Promise<void> {
		await this.sendAudioChunks([blob], fileName);
	}

	async sendAudioChunks(blobs: Blob[], fileName: string): Promise<void> {
		const baseFileName = getBaseFileName(fileName);
		const audioBlobs = blobs.filter((blob) => blob.size > 0);
		const totalAudioSize = audioBlobs.reduce(
			(total, blob) => total + blob.size,
			0
		);

		if (this.plugin.settings.debugMode) {
			new Notice(`Sending ${Math.round(totalAudioSize / 1000)} KB...`);
		}

		const isDefaultApi =
			this.plugin.settings.apiUrl ===
			"https://api.openai.com/v1/audio/transcriptions";
		if (isDefaultApi && !this.plugin.settings.apiKey) {
			new Notice("✘ Add your API key in Whisper settings");
			return;
		}

		if (totalAudioSize < MIN_AUDIO_SIZE_BYTES) {
			new Notice("✘ Recording too short");
			return;
		}

		const combinedAudioBlob = new Blob(audioBlobs, {
			type: audioBlobs[0]?.type,
		});
		const audioFilePath = await this.saveAudioFile(
			combinedAudioBlob,
			fileName
		);

		try {
			if (this.plugin.settings.debugMode) {
				new Notice(
					audioBlobs.length > 1
						? `Transcribing ${audioBlobs.length} chunks...`
						: "Transcribing..."
				);
			}
			const prompt = this.getTranscriptionPrompt();
			const transcriptionParts: string[] = [];
			for (let index = 0; index < audioBlobs.length; index++) {
				const chunkFileName = this.getChunkFileName(
					fileName,
					index,
					audioBlobs.length
				);
				const transcription = await this.transcribeAudioChunk(
					audioBlobs[index],
					chunkFileName,
					prompt
				);
				if (transcription.trim()) {
					transcriptionParts.push(transcription.trim());
				}
			}

			const wroteOutput = await this.writeTranscriptionOutput(
				transcriptionParts.join("\n\n"),
				baseFileName,
				audioFilePath
			);

			if (wroteOutput) {
				new Notice("Transcription complete");
			}
		} catch (err) {
			console.error("Error parsing audio:", err);
			new Notice(
				"✘ Transcription failed: " +
					(err instanceof Error ? err.message : String(err))
			);
		}
	}
}
