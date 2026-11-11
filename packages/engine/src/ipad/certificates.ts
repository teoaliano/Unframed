import { webcrypto } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as x509 from "@peculiar/x509";
import { leafNeedsRenewal } from "@unframed/domain";
import { writeFileAtomic } from "../atomicFile.ts";
import { errorText, logError } from "../log.ts";

type Key = webcrypto.CryptoKey;
type KeyPair = webcrypto.CryptoKeyPair;

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";
const DAY_MS = 24 * 60 * 60 * 1000;
const CA_DAYS = 3650;
export const LEAF_DAYS = 397;

export interface LeafMaterial {
  readonly leafPem: string;
  readonly leafKeyPem: string;
}

export interface Leaf extends LeafMaterial {
  readonly san: string;
  readonly notAfter: Date;
}

export interface Certificates extends Leaf {
  readonly caPem: string;
}

export const pemBody = (text: string): string => text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");

const wrapped = (base64: string): string => base64.replace(/(.{64})/g, "$1\n");

const pem = (label: string, der: ArrayBuffer): string => {
  const body = wrapped(Buffer.from(der).toString("base64"));
  return `-----BEGIN ${label}-----\n${body}${body.endsWith("\n") ? "" : "\n"}-----END ${label}-----\n`;
};

const derOfPem = (text: string): Buffer => Buffer.from(pemBody(text), "base64");

const generateKeys = (): Promise<KeyPair> => webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]) as Promise<KeyPair>;

const privateKeyPem = async (key: Key): Promise<string> => pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", key));

const readPrivateKey = (text: string): Promise<Key> =>
  webcrypto.subtle.importKey("pkcs8", derOfPem(text), ALGORITHM, true, ["sign"]) as Promise<Key>;

const serial = (): string => Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("hex");

const readText = (path: string): Promise<string | undefined> => readFile(path, "utf8").then((text) => text, () => undefined);

const sanOf = (certificate: x509.X509Certificate): string | undefined => {
  const extension = certificate.getExtension(x509.SubjectAlternativeNameExtension);
  const name = extension?.names.toJSON().find((entry) => entry.type === "dns");
  return name?.value.toLowerCase();
};

export class CertificateStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  get caPath(): string {
    return join(this.dir, "ca.pem");
  }

  private get caKeyPath(): string {
    return join(this.dir, "ca-key.pem");
  }

  private get leafPath(): string {
    return join(this.dir, "leaf.pem");
  }

  private get leafKeyPath(): string {
    return join(this.dir, "leaf-key.pem");
  }

  async ensure(localName: string, now: Date = new Date()): Promise<Certificates> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const authority = await this.ensureAuthority(localName, now);
    const existing = await this.readLeaf();
    if (existing !== undefined && !leafNeedsRenewal({ san: existing.san, notAfter: existing.notAfter }, localName, now)) {
      return { caPem: authority.pem, ...existing };
    }
    const leaf = await this.makeLeaf(authority, localName, now);
    return { caPem: authority.pem, ...leaf };
  }

  async authorityPem(localName: string, now: Date = new Date()): Promise<string> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    return (await this.ensureAuthority(localName, now)).pem;
  }

  private async ensureAuthority(localName: string, now: Date): Promise<{ pem: string; certificate: x509.X509Certificate; key: Key }> {
    const [certificateText, keyText] = await Promise.all([readText(this.caPath), readText(this.caKeyPath)]);
    if (certificateText !== undefined && keyText !== undefined) {
      try {
        return { pem: certificateText, certificate: new x509.X509Certificate(certificateText), key: await readPrivateKey(keyText) };
      } catch (error) {
        logError(`ipad: the local certificate authority could not be read, so a new one is made and every paired iPad has to trust it again: ${errorText(error)}`);
      }
    }
    const keys = await generateKeys();
    const certificate = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: serial(),
      name: `CN=Unframed local CA (${localName})`,
      notBefore: now,
      notAfter: new Date(now.getTime() + CA_DAYS * DAY_MS),
      keys,
      signingAlgorithm: ALGORITHM,
      extensions: [
        new x509.BasicConstraintsExtension(true, 0, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign, true),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    const text = certificate.toString("pem");
    await writeFileAtomic(this.caKeyPath, await privateKeyPem(keys.privateKey));
    await writeFileAtomic(this.caPath, text);
    return { pem: text, certificate, key: keys.privateKey };
  }

  private async readLeaf(): Promise<Leaf | undefined> {
    const [certificateText, keyText] = await Promise.all([readText(this.leafPath), readText(this.leafKeyPath)]);
    if (certificateText === undefined || keyText === undefined) return undefined;
    try {
      const certificate = new x509.X509Certificate(certificateText);
      const san = sanOf(certificate);
      if (san === undefined) return undefined;
      return { leafPem: certificateText, leafKeyPem: keyText, san, notAfter: certificate.notAfter };
    } catch {
      return undefined;
    }
  }

  private async makeLeaf(
    authority: { certificate: x509.X509Certificate; key: Key },
    localName: string,
    now: Date,
  ): Promise<Leaf> {
    const keys = await generateKeys();
    const notAfter = new Date(now.getTime() + LEAF_DAYS * DAY_MS);
    const certificate = await x509.X509CertificateGenerator.create({
      serialNumber: serial(),
      subject: `CN=${localName}`,
      issuer: authority.certificate.subject,
      notBefore: now,
      notAfter,
      signingKey: authority.key,
      publicKey: keys.publicKey,
      signingAlgorithm: ALGORITHM,
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
        new x509.ExtendedKeyUsageExtension([SERVER_AUTH], true),
        new x509.SubjectAlternativeNameExtension([{ type: "dns", value: localName }]),
        await x509.AuthorityKeyIdentifierExtension.create(authority.certificate),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      ],
    });
    const leafPem = certificate.toString("pem");
    const leafKeyPem = await privateKeyPem(keys.privateKey);
    await writeFileAtomic(this.leafKeyPath, leafKeyPem);
    await writeFileAtomic(this.leafPath, leafPem);
    return { leafPem, leafKeyPem, san: localName.toLowerCase(), notAfter };
  }
}
