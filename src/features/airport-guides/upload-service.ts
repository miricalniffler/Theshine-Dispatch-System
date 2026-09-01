import { db } from "@/lib/db";
import { AirportGuideServiceError } from "./service";
import { airportGuideStorageClient, airportGuideStorageConfig } from "./storage";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function safeFilename(name: string) {
  const cleaned = name.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return cleaned || "guide-image";
}

export async function uploadAirportGuideImages(airportGuideId: string, files: File[]) {
  const guide = await db.airportGuide.findUnique({ where: { id: airportGuideId }, select: { id: true } });
  if (!guide) throw new AirportGuideServiceError("NOT_FOUND", "找不到机场指引。");
  const config = airportGuideStorageConfig();
  if (!config) throw new AirportGuideServiceError("STORAGE_NOT_CONFIGURED", "机场指引图片存储尚未配置。请由账号所有者在 Vercel 配置 SUPABASE_SERVICE_ROLE_KEY 和 SUPABASE_AIRPORT_GUIDES_BUCKET，并创建对应的 Supabase Storage bucket。");
  if (!files.length) throw new AirportGuideServiceError("IMAGE_REQUIRED", "请选择至少一张图片。");
  if (files.some((file) => !file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES)) throw new AirportGuideServiceError("INVALID_IMAGE", "只支持单张不超过 10MB 的图片。");

  const currentCount = await db.airportGuideImage.count({ where: { airportGuideId } });
  const client = airportGuideStorageClient(config);
  const created: string[] = [];
  try {
    for (const [index, file] of files.entries()) {
      const path = `${airportGuideId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await client.storage.from(config.bucket).upload(path, bytes, { contentType: file.type, upsert: false });
      if (upload.error) throw new AirportGuideServiceError("STORAGE_UPLOAD_FAILED", `图片上传失败：${upload.error.message}`);
      created.push(path);
      await db.airportGuideImage.create({ data: { airportGuideId, storageBucket: config.bucket, storagePath: path, originalFilename: file.name || null, mimeType: file.type, byteSize: file.size, sortOrder: currentCount + index } });
    }
  } catch (error) {
    if (created.length) await client.storage.from(config.bucket).remove(created).catch(() => undefined);
    throw error;
  }
  return db.airportGuideImage.findMany({ where: { airportGuideId }, orderBy: { sortOrder: "asc" } });
}

export async function removeAirportGuideImage(airportGuideId: string, imageId: string) {
  const image = await db.airportGuideImage.findFirst({ where: { id: imageId, airportGuideId } });
  if (!image) throw new AirportGuideServiceError("IMAGE_NOT_FOUND", "找不到该图片。");
  const config = airportGuideStorageConfig();
  if (!config || config.bucket !== image.storageBucket) throw new AirportGuideServiceError("STORAGE_NOT_CONFIGURED", "图片存储尚未配置，暂不能安全删除图片。");
  const client = airportGuideStorageClient(config);
  const removal = await client.storage.from(image.storageBucket).remove([image.storagePath]);
  if (removal.error) throw new AirportGuideServiceError("STORAGE_DELETE_FAILED", `图片删除失败：${removal.error.message}`);
  await db.airportGuideImage.delete({ where: { id: image.id } });
}
