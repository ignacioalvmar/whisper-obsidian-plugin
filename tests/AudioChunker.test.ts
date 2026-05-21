import { describe, expect, it } from "vitest";
import {
	AudioChunkBuffer,
	MAX_TRANSCRIPTION_UPLOAD_BYTES,
} from "../src/AudioChunker";

describe("AudioChunkBuffer", () => {
	it("keeps chunks below the transcription upload safety limit", () => {
		const buffer = new AudioChunkBuffer(10, "audio/webm");

		buffer.add(new Blob(["1234"], { type: "audio/webm" }));
		buffer.add(new Blob(["5678"], { type: "audio/webm" }));
		buffer.add(new Blob(["9012"], { type: "audio/webm" }));

		const chunks = buffer.finish();

		expect(chunks).toHaveLength(2);
		expect(chunks[0].size).toBe(8);
		expect(chunks[1].size).toBe(4);
		expect(chunks.every((chunk) => chunk.size <= 10)).toBe(true);
	});

	it("resets after finish", () => {
		const buffer = new AudioChunkBuffer(10, "audio/webm");

		buffer.add(new Blob(["1234"], { type: "audio/webm" }));
		expect(buffer.finish()).toHaveLength(1);
		expect(buffer.finish()).toHaveLength(0);
	});

	it("uses a safety threshold below the 25MB Whisper limit", () => {
		expect(MAX_TRANSCRIPTION_UPLOAD_BYTES).toBeLessThan(25 * 1024 * 1024);
	});
});
