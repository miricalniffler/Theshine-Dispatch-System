import { createClient } from "@supabase/supabase-js";

export type AirportGuideStorageConfig = { url: string; serviceRoleKey: string; bucket: string };

export function airportGuideStorageConfig(): AirportGuideStorageConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_AIRPORT_GUIDES_BUCKET;
  return url && serviceRoleKey && bucket ? { url, serviceRoleKey, bucket } : null;
}

export function airportGuidePublicUrl(bucket: string, path: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function airportGuideStorageClient(config: AirportGuideStorageConfig) {
  return createClient(config.url, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
