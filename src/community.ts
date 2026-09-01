import type { PublicRoomMessage } from "./data/api";
import { verifyDidSignature } from "./identity/vault";

const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;

export const AGENT_GUILD_ROOM = "d-agent-guild";

export function rawTechnocoreRoomUrl(room = AGENT_GUILD_ROOM): string {
  if (!ROOM_PATTERN.test(room)) throw new Error("Unsafe Technocore room name.");
  return `https://technocore.chat/r/${room}`;
}

export async function verifyPublicRoomMessage(room: string, message: PublicRoomMessage): Promise<boolean> {
  if (!ROOM_PATTERN.test(room) || !DID_PATTERN.test(message.from) || !message.nonce || !message.signature) return false;
  try {
    return await verifyDidSignature(message.from, `${room}|${message.nonce}|${message.text}`, message.signature);
  } catch {
    return false;
  }
}
