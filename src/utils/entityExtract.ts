/** Extract VNR, customer name, phone from German care-call transcripts. */
export function extractEntitiesFromTranscript(transcript: string): {
  customer_name?: string;
  vnr?: string;
  phone?: string;
} {
  const out: { customer_name?: string; vnr?: string; phone?: string } = {};
  const vnrMatch = transcript.match(/\b(?:VNR|Versichertennummer|Versicherungsnummer)[:\s]*([A-Z0-9]{8,12})\b/i);
  if (vnrMatch) out.vnr = vnrMatch[1].toUpperCase();

  const nameMatch = transcript.match(
    /(?:mein Name ist|ich heiße|ich bin|hier spricht|Name)[:\s]+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)/i
  );
  if (nameMatch) out.customer_name = nameMatch[1].trim();

  const phoneMatch = transcript.match(/\b(?:0\d{2,4}[\s/-]?\d{3,10}|\+49[\d\s/-]{8,15})\b/);
  if (phoneMatch) out.phone = phoneMatch[0].replace(/\s+/g, ' ').trim();

  return out;
}
