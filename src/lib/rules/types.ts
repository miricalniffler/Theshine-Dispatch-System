export type RulesConfig = {
  rules_version: string;
  timezone: string;
  templates: {
    dispatch: {
      header: string;
      body: string;
      meet_greet: { standard_line: string; greeting_sign_line: string };
    };
    dispatch_batch_footers: Record<string, string>;
    iway_return: { header: string; body: string; footer: string };
  };
  validation: {
    before_dispatch: string[];
    before_iway_return: string[];
  };
  transforms: {
    luggage: { default_to_passenger_count_when_unspecified: boolean };
    phone: {
      display: { country_calling_codes: string[]; separator: string };
      thailand: { country_code: string; convert_local_leading_zero: boolean; local_digit_lengths: number[] };
    };
    // A maintained catalog of confirmed brand + model names.  An alias is
    // expanded only when it identifies exactly one catalog entry.
    vehicle_models: Array<{ brand: string; canonical_name: string; model_aliases: string[]; brand_aliases?: string[]; aliases?: string[] }>;
    vehicle_aliases: Record<string, string>;
    generic_vehicle_labels_not_allowed_for_return: string[];
  };
  thresholds: { dispatch_missing_hours_before_pickup: number; driver_details_missing_hours_before_pickup: number };
  duplicate_detection: { compare_fields: string[]; pickup_time_window_minutes: number };
};

export type RuleValidationScope = "before_dispatch" | "before_iway_return";
