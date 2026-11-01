/**
 * Transcription of 车型标准.xlsx, sheet 车型标准 (29 rows including header),
 * received 2026-11-01.  Source keys make repeated imports idempotent and the
 * original values remain available for later audit.
 */
export type InitialVehicleStandard = {
  sourceKey: string; internalGrade: string; description: string; passengers: number; luggage: number;
  scope: "GLOBAL" | "TH_KH_VN_LK_NP" | "EUROPE" | "KR"; countryLabel: string | null; aliases: string[];
};

const global = (key: string, grade: string, description: string, passengers: number, luggage: number, aliases: string[]): InitialVehicleStandard => ({ sourceKey: key, internalGrade: grade, description, passengers, luggage, aliases, scope: "GLOBAL", countryLabel: null });
const asia5 = (key: string, grade: string, description: string, passengers: number, luggage: number, aliases: string[]): InitialVehicleStandard => ({ sourceKey: key, internalGrade: grade, description, passengers, luggage, aliases, scope: "TH_KH_VN_LK_NP", countryLabel: "泰国、柬埔寨、越南、斯里兰卡、尼泊尔" });
const europe = (key: string, grade: string, description: string, passengers: number, luggage: number, aliases: string[]): InitialVehicleStandard => ({ sourceKey: key, internalGrade: grade, description, passengers, luggage, aliases, scope: "EUROPE", countryLabel: "欧洲全境" });
const korea = (key: string, grade: string, description: string, passengers: number, luggage: number, aliases: string[]): InitialVehicleStandard => ({ sourceKey: key, internalGrade: grade, description, passengers, luggage, aliases, scope: "KR", countryLabel: "韩国" });

export const INITIAL_VEHICLE_STANDARDS: InitialVehicleStandard[] = [
  global("xlsx-01", "经济5座", "丰田卡罗拉、大众速腾等同级车", 4, 2, ["Toyota Corolla", "Volkswagen Sagitar"]),
  asia5("xlsx-02", "经济5座", "丰田卡罗拉、宝腾PERSON等同级车", 3, 2, ["Toyota Corolla", "Proton Persona"]),
  global("xlsx-03", "经济7座", "丰田innova、雷诺大风景等同级车", 6, 2, ["Toyota Innova", "Renault Grand Scenic"]),
  asia5("xlsx-04", "经济7座", "丰田innova、丰田Fortuner等同级车", 5, 2, ["Toyota Innova", "Toyota Fortuner"]),
  europe("xlsx-05", "经济7座", "福特S-MAX、雷诺大风景等同级车", 6, 2, ["Ford S-MAX", "Renault Grand Scenic"]),
  korea("xlsx-06", "经济7座", "起亚嘉华等同级车", 4, 4, ["Kia Carnival"]),
  global("xlsx-07", "舒适5座", "本田雅阁、大众帕萨特等同级车", 4, 2, ["Honda Accord", "Volkswagen Passat"]),
  global("xlsx-08", "舒适7座", "本田奥德赛、丰田塞纳等同级车", 6, 4, ["Honda Odyssey", "Toyota Sienna"]),
  europe("xlsx-09", "舒适7座", "大众夏朗、蓝旗亚等同级车", 5, 4, ["Volkswagen Sharan", "Lancia"]),
  korea("xlsx-10", "舒适7座", "起亚嘉华等同级车", 4, 4, ["Kia Carnival"]),
  global("xlsx-11", "舒适8座", "大众T5等同级车", 7, 4, ["Volkswagen T5"]),
  global("xlsx-12", "舒适9座", "雷诺Trafic 欧宝Vivaro等同级", 8, 5, ["Renault Trafic", "Opel Vivaro"]),
  korea("xlsx-13", "舒适9座", "现代斯塔克斯等同级", 6, 5, ["Hyundai Starex"]),
  global("xlsx-14", "舒适10座", "现代斯塔克斯等同级车", 9, 5, ["Hyundai Starex"]),
  asia5("xlsx-15", "舒适10座", "丰田海狮等同级车", 8, 5, ["Toyota Hiace"]),
  global("xlsx-16", "舒适12座", "丰田海狮、奔驰斯宾特12座", 11, 6, ["Toyota Hiace", "Mercedes-Benz Sprinter 12"]),
  asia5("xlsx-17", "舒适12座", "丰田海狮12座", 10, 6, ["Toyota Hiace 12"]),
  global("xlsx-18", "舒适14座", "丰田海狮等同等级车", 13, 7, ["Toyota Hiace"]),
  global("xlsx-19", "豪华5座", "奥迪A6、宝马5系等同级车", 4, 2, ["Audi A6", "BMW 5 Series"]),
  global("xlsx-20", "豪华7座", "丰田埃尔法、奔驰v-class等同级车", 6, 4, ["Toyota Alphard", "Mercedes-Benz V-Class"]),
  europe("xlsx-21", "豪华8座", "奔驰viano，奔驰vito", 7, 4, ["Mercedes-Benz Viano", "Mercedes-Benz Vito"]),
  europe("xlsx-22", "豪华9座", "奔驰vito，大众T6等同级车", 8, 5, ["Mercedes-Benz Vito", "Volkswagen T6"]),
  global("xlsx-23", "豪华12座", "奔驰sprinter，雷诺Master等同级车", 11, 11, ["Mercedes-Benz Sprinter", "Renault Master"]),
  global("xlsx-24", "奢华5座", "奔驰S、宝马7系等同级车", 4, 2, ["Mercedes-Benz S-Class", "BMW 7 Series"]),
  global("xlsx-25", "15座小巴", "考斯特等同级车", 14, 10, ["Toyota Coaster"]),
  global("xlsx-26", "18座中巴", "考斯特等同级车", 17, 10, ["Toyota Coaster"]),
  global("xlsx-27", "20座中巴", "考斯特巴士等同级车", 19, 15, ["Toyota Coaster Bus"]),
  global("xlsx-28", "特斯拉", "特斯拉", 4, 2, ["Tesla"]),
];

export function expandScope(scope: InitialVehicleStandard["scope"]) {
  if (scope === "TH_KH_VN_LK_NP") return ["TH", "KH", "VN", "LK", "NP"];
  return scope === "GLOBAL" ? [] : [scope];
}
