export const MAX_TRANSCRIPTION_UPLOAD_BYTES = 24 * 1024 * 1024;

export class AudioChunkBuffer {
	private completedChunks: Blob[] = [];
	private currentParts: BlobPart[] = [];
	private currentSize = 0;
	private maxBytes: number;
	private mimeType: string | undefined;

	constructor(
		maxBytes: number = MAX_TRANSCRIPTION_UPLOAD_BYTES,
		mimeType?: string
	) {
		this.maxBytes = maxBytes;
		this.mimeType = mimeType;
	}

	setMimeType(mimeType: string | undefined): void {
		this.mimeType = mimeType;
	}

	add(data: Blob): void {
		if (data.size === 0) {
			return;
		}

		if (
			this.currentSize > 0 &&
			this.currentSize + data.size > this.maxBytes
		) {
			this.flushCurrentChunk();
		}

		this.currentParts.push(data);
		this.currentSize += data.size;

		if (this.currentSize >= this.maxBytes) {
			this.flushCurrentChunk();
		}
	}

	finish(): Blob[] {
		this.flushCurrentChunk();
		const chunks = this.completedChunks;
		this.reset();
		return chunks;
	}

	reset(): void {
		this.completedChunks = [];
		this.currentParts = [];
		this.currentSize = 0;
	}

	private flushCurrentChunk(): void {
		if (this.currentSize === 0) {
			return;
		}

		this.completedChunks.push(
			new Blob(this.currentParts, { type: this.mimeType })
		);
		this.currentParts = [];
		this.currentSize = 0;
	}
}
