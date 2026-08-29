import { signText, unlockIdentity, type EncryptedIdentity } from "./vault";

export interface SignerProvider {
  getDid(): Promise<string>;
  proveControl(challenge: Uint8Array): Promise<string>;
  sign(payload: Uint8Array, approvalGrant: string): Promise<string>;
  lock(): Promise<void>;
}

export class BrowserVaultSigner implements SignerProvider {
  #key: CryptoKey | null = null;
  #grant: string | null = null;
  #lockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly identity: EncryptedIdentity) {}

  async unlock(passphrase: string): Promise<void> {
    this.#key = await unlockIdentity(this.identity, passphrase);
    this.#scheduleLock();
  }

  grantOnce(): string {
    if (!this.#key) throw new Error("Unlock the local identity first.");
    this.#grant = crypto.randomUUID();
    return this.#grant;
  }

  async getDid(): Promise<string> { return this.identity.did; }

  async proveControl(challenge: Uint8Array): Promise<string> {
    if (!this.#key) throw new Error("Identity is locked.");
    return signText(this.#key, new TextDecoder().decode(challenge));
  }

  async sign(payload: Uint8Array, approvalGrant: string): Promise<string> {
    if (!this.#key) throw new Error("Identity is locked.");
    if (!this.#grant || approvalGrant !== this.#grant) throw new Error("A fresh one-time approval is required.");
    this.#grant = null;
    const signature = await signText(this.#key, new TextDecoder().decode(payload));
    await this.lock();
    return signature;
  }

  async lock(): Promise<void> {
    if (this.#lockTimer) clearTimeout(this.#lockTimer);
    this.#lockTimer = null;
    this.#key = null;
    this.#grant = null;
  }

  #scheduleLock(): void {
    if (this.#lockTimer) clearTimeout(this.#lockTimer);
    this.#lockTimer = setTimeout(() => { void this.lock(); }, 10 * 60 * 1000);
  }
}

export class ExternalSigner implements SignerProvider {
  constructor(
    private readonly did: string,
    private readonly requestSignature: (payload: Uint8Array, approvalGrant?: string) => Promise<string>,
  ) {}

  async getDid(): Promise<string> { return this.did; }
  async proveControl(challenge: Uint8Array): Promise<string> { return this.requestSignature(challenge); }
  async sign(payload: Uint8Array, approvalGrant: string): Promise<string> {
    if (!approvalGrant) throw new Error("A fresh one-time approval is required.");
    return this.requestSignature(payload, approvalGrant);
  }
  async lock(): Promise<void> {}
}
