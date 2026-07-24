import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { RulesConfig } from "./types";

const rulesPath = path.join(process.cwd(), "config", "business-rules.yaml");

const rulesSchema = z.object({
  rules_version: z.string().min(1),
  timezone: z.string().min(1),
  templates: z.object({
    dispatch: z.object({
      header: z.string(),
      body: z.string(),
      meet_greet: z.object({ standard_line: z.string(), greeting_sign_line: z.string() }),
    }),
    dispatch_batch_footers: z.record(z.string(), z.string()),
    iway_return: z.object({ header: z.string(), body: z.string(), footer: z.string() }),
  }),
  validation: z.object({ before_dispatch: z.array(z.string()), before_iway_return: z.array(z.string()) }),
  transforms: z.object({
    luggage: z.object({ default_to_passenger_count_when_unspecified: z.boolean() }),
    phone: z.object({
      display: z.object({ country_calling_codes: z.array(z.string().regex(/^\+\d+$/)), separator: z.string().min(1) }),
      thailand: z.object({ country_code: z.string(), convert_local_leading_zero: z.boolean(), local_digit_lengths: z.array(z.number()) }),
    }),
    vehicle_aliases: z.record(z.string(), z.string()),
  }),
  thresholds: z.object({ dispatch_missing_hours_before_pickup: z.number(), driver_details_missing_hours_before_pickup: z.number() }),
  duplicate_detection: z.object({ compare_fields: z.array(z.string()), pickup_time_window_minutes: z.number() }),
});

export function parseRules(raw: string): RulesConfig {
  return rulesSchema.parse(yaml.load(raw)) as RulesConfig;
}

export function loadRules(): RulesConfig {
  const raw = fs.readFileSync(rulesPath, "utf8");
  return parseRules(raw);
}

export function loadRulesSource() { return fs.readFileSync(rulesPath, "utf8"); }

export function getRulesFilePath() {
  return rulesPath;
}
