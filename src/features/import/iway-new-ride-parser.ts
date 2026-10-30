import { detectDispatchCity } from "@/lib/city/detect-city";
import { detectServiceTimeZone, type ServiceTimeZoneDetection } from "./service-timezone";

export type ParsedIwayNewRide = {
  platformOrderNumber: string;
  passengerName: string;
  passengerPhone: string;
  pickupDateTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  platformVehicleType: string;
  flightNumber: string;
  adults: number;
  children: number;
  luggage: number;
  meetGreetLine: string;
  city: string;
  cityDetection: ReturnType<typeof detectDispatchCity>;
  serviceTimeZone: string;
  timeZoneDetection: ServiceTimeZoneDetection;
  otherNotes: string;
};

function pick(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim() || "";
}

function numberFrom(value: string) {
  return Number(value.match(/\d+/)?.[0] || 0);
}

function phoneFrom(value: string) {
  const normalised = value.replace(/[–—]/g, "-");
  return normalised.match(/(?:\+?\d[\d\s()\-]{5,}\d)/)?.[0]?.replace(/\s+/g, " ").trim() || "";
}

function addressFrom(value: string) {
  return value
    .replace(/\s+(?:rent\s+a\s+vehicle|intercity|waiting\s+time|child\s+seat|extra\s+services?)\s*:[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastPassengerName(value: string) {
  return value.split(/\s*(?:,|;|\/|\n|\s+&\s+|\s+and\s+)\s*/i).map((name) => name.trim()).filter(Boolean).at(-1) || "";
}

function platformVehicleLabel(value: string) {
  const category = value.replace(/\s+/g, " ").split("(")[0].trim();
  return /^C$/i.test(category) ? "COMFORT" : category;
}

/** Identifies the verified structured iWay “New ride” email format, not a cancellation or amendment. */
export function isIwayNewRideEmail(text: string) {
  return /Ride number\s*[:：]/i.test(text)
    && /Vehicle class\s*[:：]/i.test(text)
    && ((/Itinerary\s*[:：]/i.test(text) && /Clients\s*[:：]/i.test(text))
      || (/Transfer\s*[:：]/i.test(text) && /Passengers\s*[:：]/i.test(text)
        && /Pick-up date\s*[:：]/i.test(text) && /Local pick-up time\s*[:：]/i.test(text)));
}

// Table-based transfer notices put values on the following line. Bound each
// field by the next known label so an empty flight/remarks cannot consume it.
const transferLabels = "Ride number|City|Pick-up date|Local pick-up time|Vehicle class|Pax|Transfer|Rent a vehicle|Intercity|Flight number|Greeting sign|Additional remarks|i[’']way notes|Additional services|Passengers";
function transferField(text: string, label: string) {
  return text.match(new RegExp(`(?:^|\\n)[ \\t]*(?:${label})[ \\t]*[:：]([\\s\\S]*?)(?=\\n[ \\t]*(?:${transferLabels})[ \\t]*[:：]|$)`, "i"))?.[1]?.trim() || "";
}

/**
 * Parses only fields explicitly present in a structured iWay New ride email.
 * It never infers missing addresses, telephone numbers, or city.
 */
function serviceDateFor(dateValue: string, departureValue: string, referenceDate?: Date) {
  const english = dateValue.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})$/i);
  if (english) {
    const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(english[1].toLowerCase()) + 1;
    const day = Number(english[2]);
    const date = new Date(Date.UTC(Number(english[3]), month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${english[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
  }
  const date = dateValue.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](20\d{2}))?/);
  if (!date) return "";
  const [, day, month, explicitYear] = date;
  const departureYear = departureValue.match(/(20\d{2})/)?.[1];
  let year = explicitYear || departureYear;
  if (!year && referenceDate && !Number.isNaN(referenceDate.getTime())) {
    year = String(referenceDate.getUTCFullYear());
    const candidate = Date.UTC(Number(year), Number(month) - 1, Number(day));
    // A “new ride” received near year-end with a calendar day that already
    // passed is for the coming year.  This is bounded to date-only messages;
    // an explicit year always wins.
    if (candidate < Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate())) year = String(Number(year) + 1);
  }
  return year ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
}

export function parseIwayNewRide(text: string, options: { referenceDate?: Date } = {}): ParsedIwayNewRide {
  text = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const transferNotice = /(?:^|\n)\s*Transfer\s*[:：]/i.test(text) && /(?:^|\n)\s*Passengers\s*[:：]/i.test(text);
  const rideNumber = pick(text, "Ride number").replace(/^\s*(?:ride|order(?:\s*(?:number|no\\.?|id))?)?\s*[:#№-]*\s*/i, "").replace(/\s/g, "");
  const date = transferNotice ? transferField(text, "Pick-up date") : pick(text, "Date");
  const time = transferNotice ? transferField(text, "Local pick-up time") : pick(text, "Time");
  const flightDeparture = pick(text, "Departure time");
  const serviceDate = serviceDateFor(date, flightDeparture, options.referenceDate);
  const itinerary = text.match(/Itinerary\s*:\s*([\s\S]*?)(?=Flight number\/train number\s*:|Departure time\s*:|Remarks\s*:)/i)?.[1] || "";
  const transfer = transferNotice ? transferField(text, "Transfer").split(/\s*⇒\s*/) : [];
  const pickupAddress = addressFrom(transferNotice ? (transfer.length === 2 ? transfer[0] : "") : itinerary.match(/From\s*:\s*([\s\S]*?)(?=\n\s*To\s*:)/i)?.[1] || "");
  const dropoffAddress = addressFrom(transferNotice ? (transfer.length === 2 ? transfer[1] : "") : itinerary.match(/To\s*:\s*([^\n]+)/i)?.[1] || "");
  const clients = transferNotice ? transferField(text, "Passengers").split("\n").map(line => line.trim()).filter(Boolean)[0] || "" : pick(text, "Clients");
  const passengerPhone = phoneFrom(clients.match(/phone\s*:?\s+([\s\S]*)/i)?.[1] || "");
  const passengerName = lastPassengerName(clients.replace(/,?\s*phone\s*:?\s+[+\d][\d\s-]+.*$/i, "").trim());
  const children = numberFrom(pick(text, "Children"));
  const statedAdults = pick(text, "Adults");
  const totalPassengers = numberFrom(transferNotice ? transferField(text, "Pax") : pick(text, "Number of passengers"));
  const adults = statedAdults ? numberFrom(statedAdults) : Math.max(0, totalPassengers - children);
  const statedLuggage = pick(text, "(?:Luggage|Number of luggage|Baggage)");
  const signName = transferNotice ? transferField(text, "Greeting sign") : pick(text, "(?:Meeting tablet|Greeting sign|Meeting sign|Meet(?:ing)?&?Greet)");
  const cityDetection = detectDispatchCity(pickupAddress, dropoffAddress);
  const timeZoneDetection = detectServiceTimeZone(pickupAddress, dropoffAddress);
  return {
    platformOrderNumber: rideNumber,
    passengerName,
    passengerPhone,
    pickupDateTime: serviceDate && time ? `${serviceDate}T${time.slice(0, 5)}` : "",
    pickupAddress,
    dropoffAddress,
    platformVehicleType: platformVehicleLabel(transferNotice ? transferField(text, "Vehicle class").split(/Model cars\s*:/i)[0] : pick(text, "Vehicle class")),
    flightNumber: transferNotice ? transferField(text, "Flight number") : pick(text, "Flight number/train number"),
    adults,
    children,
    luggage: statedLuggage ? numberFrom(statedLuggage) : adults + children,
    meetGreetLine: signName || (/meet\s*&?\s*greet|举牌/i.test(text) ? "Meet&Greet" : ""),
    city: cityDetection.city ?? "",
    cityDetection,
    serviceTimeZone: timeZoneDetection.timeZone ?? "",
    timeZoneDetection,
    otherNotes: [flightDeparture && `Flight departure: ${flightDeparture}`, signName && `Meeting tablet: ${signName}`, transferNotice ? transferField(text, "Additional remarks").replace(/\.[\w-]+[^{}]*\{[^{}]*\}/g, "").trim() : pick(text, "Remarks")].filter(Boolean).join("\n"),
  };
}
