export type AirportMatchKind = "ALIAS" | "ADDRESS_KEYWORD";

export type AirportGuideInput = {
  airportName: string;
  iataCode?: string | null;
  terminal?: string | null;
  guideText: string;
  isActive: boolean;
  aliases: string[];
  addressKeywords: string[];
};

export type AirportGuideImageView = {
  id: string;
  originalFilename: string | null;
  mimeType: string;
  byteSize: number | null;
  sortOrder: number;
  publicUrl: string | null;
};

export type AirportGuideView = {
  id: string;
  airportName: string;
  iataCode: string | null;
  terminal: string | null;
  guideText: string;
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
  addressKeywords: string[];
  images: AirportGuideImageView[];
};

export type RegionNotificationSettingView = {
  region: string;
  customerWhatsAppEnabled: boolean;
  updatedAt: string;
};
