/**
 * Wrexlyn — Copyright (c) 2026 Nishant Prabhakar. All rights reserved.
 * Unauthorized copying, modification, or distribution is prohibited.
 * See LICENSE for details.
 *
 * Shared image loading/sizing for the Word and PowerPoint generators. Reads
 * intrinsic pixel dimensions straight from the file header (no image
 * library — same hand-rolled-byte-parsing approach used for this project's
 * PNG icon) so an image inserted without explicit width/height still keeps
 * its real aspect ratio instead of coming out squashed or stretched.
 */
import * as fs from "fs";
import * as path from "path";
import { resolveInRoot } from "./paths";

export type ImageType = "jpg" | "png" | "gif" | "bmp";

const EXT_TYPES: Record<string, ImageType> = {
  ".png": "png",
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".gif": "gif",
  ".bmp": "bmp",
};

export interface LoadedImage {
  buffer: Buffer;
  type: ImageType;
  /** Intrinsic pixel dimensions, or null if they couldn't be parsed from the file header. */
  intrinsic: { width: number; height: number } | null;
}

export interface ImageLoadError {
  error: string;
}

/** Resolves, validates, and reads an image file for embedding. Never throws. */
export function loadImageFile(root: string, relPath: string, maxBytes: number): LoadedImage | ImageLoadError {
  if (!relPath) return { error: "An image needs a 'path' pointing to an image file." };

  let abs: string;
  try {
    abs = resolveInRoot(root, relPath);
  } catch (err: any) {
    return { error: err.message ?? String(err) };
  }

  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { error: `Image not found: ${relPath}` };
  }

  const type = EXT_TYPES[path.extname(abs).toLowerCase()];
  if (!type) {
    return { error: `Unsupported image type for "${relPath}" — use .png, .jpg, .gif, or .bmp.` };
  }

  const stat = fs.statSync(abs);
  if (stat.size > maxBytes) {
    return { error: `Image "${relPath}" is ${Math.round(stat.size / 1024 / 1024)}MB, over the ${Math.round(maxBytes / 1024 / 1024)}MB limit.` };
  }

  const buffer = fs.readFileSync(abs);
  return { buffer, type, intrinsic: readIntrinsicDimensions(buffer, type) };
}

function readIntrinsicDimensions(buf: Buffer, type: ImageType): { width: number; height: number } | null {
  try {
    if (type === "png" && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (type === "gif" && buf.length >= 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (type === "bmp" && buf.length >= 26) {
      const width = buf.readInt32LE(18);
      const height = Math.abs(buf.readInt32LE(22));
      return { width, height };
    }
    if (type === "jpg") {
      let offset = 2; // skip the SOI marker (0xFFD8)
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0-SOF3 (baseline/extended/progressive/lossless) carry the frame dimensions.
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2;
          continue;
        }
        const segmentLength = buf.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fits an image into a box in inches, preserving its real aspect ratio when
 * known. Both dimensions explicit -> used as-is (the caller accepted a
 * stretched result deliberately). One explicit -> the other is derived from
 * the aspect ratio. Neither explicit -> a sensible default width, capped to
 * `maxWidthIn`, with height derived from the aspect ratio (or a 0.6 fallback
 * ratio if the file's intrinsic dimensions couldn't be read).
 *
 * `maxHeightIn`, when given, additionally caps the *derived* dimension —
 * width is scaled back down to keep it under the height limit too. This
 * only applies where height isn't itself the explicit, caller-chosen value:
 * a portrait screenshot (tall aspect ratio) sized only by width would
 * otherwise derive a height far taller than a slide/page actually has room
 * for, running the image off the bottom edge.
 */
export function fitImageBox(
  intrinsic: { width: number; height: number } | null,
  maxWidthIn: number,
  requestedWidthIn?: number,
  requestedHeightIn?: number,
  maxHeightIn?: number
): { widthIn: number; heightIn: number } {
  const aspect = intrinsic && intrinsic.width > 0 ? intrinsic.height / intrinsic.width : 0.6;
  const capHeight = (widthIn: number, heightIn: number) => {
    if (!maxHeightIn || heightIn <= maxHeightIn) return { widthIn, heightIn };
    return { widthIn: widthIn * (maxHeightIn / heightIn), heightIn: maxHeightIn };
  };

  if (requestedWidthIn && requestedWidthIn > 0 && requestedHeightIn && requestedHeightIn > 0) {
    return { widthIn: requestedWidthIn, heightIn: requestedHeightIn };
  }
  if (requestedWidthIn && requestedWidthIn > 0) {
    const widthIn = Math.min(requestedWidthIn, maxWidthIn);
    return capHeight(widthIn, widthIn * aspect);
  }
  if (requestedHeightIn && requestedHeightIn > 0) {
    return { widthIn: Math.min(requestedHeightIn / aspect, maxWidthIn), heightIn: requestedHeightIn };
  }
  const widthIn = Math.min(4.5, maxWidthIn);
  return capHeight(widthIn, widthIn * aspect);
}
