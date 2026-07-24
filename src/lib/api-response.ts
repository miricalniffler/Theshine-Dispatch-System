import { NextResponse } from "next/server";
import type { ApiFailure, ApiSuccess } from "@/types/domain";

export function success<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ data }, { status });
}

export function failure(code: string, message: string, fields?: string[], status = 400) {
  const error: ApiFailure["error"] = { code, message };
  if (fields?.length) error.fields = fields;
  return NextResponse.json<ApiFailure>({ error }, { status });
}
