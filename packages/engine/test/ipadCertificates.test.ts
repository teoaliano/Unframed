import { webcrypto } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as x509 from "@peculiar/x509";
import { describe, expect, it } from "vitest";
import { type TestEngine } from "./harness.ts";
import { deviceRequest, deviceSocket, ipadPortOf, readAuthority, startIpadEngine, TEST_NAME } from "./ipadClient.ts";

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const DAY_MS = 24 * 60 * 60 * 1000;
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

const ipadFile = (dataDir: string, name: string) => join(dataDir, "ipad", name);
const readCertificate = async (dataDir: string, name: string) => new x509.X509Certificate(await readFile(ipadFile(dataDir, name), "utf8"));
const mode = async (path: string) => ((await stat(path)).mode & 0o777).toString(8);
const daysLeft = (certificate: x509.X509Certificate) => Math.round((certificate.notAfter.getTime() - Date.now()) / DAY_MS);

const start = (options: { name?: string; dataDir?: string } = {}): Promise<TestEngine> => startIpadEngine(options);

describe("the local certificate authority", () => {
  it("writes the authority and its leaf once, with the private keys readable by their owner only", async () => {
    const engine = await start();
    await ipadPortOf(engine);

    expect(await mode(ipadFile(engine.dataDir, "ca-key.pem"))).toBe("600");
    expect(await mode(ipadFile(engine.dataDir, "leaf-key.pem"))).toBe("600");

    const ca = await readCertificate(engine.dataDir, "ca.pem");
    expect(ca.subject).toBe(`CN=Unframed local CA (${TEST_NAME})`);
    expect(ca.issuer).toBe(ca.subject);
    expect(daysLeft(ca)).toBe(3650);
    const constraints = ca.getExtension(x509.BasicConstraintsExtension);
    expect(constraints?.ca).toBe(true);
    expect(constraints?.pathLength).toBe(0);
    expect(ca.getExtension(x509.KeyUsagesExtension)?.usages).toBe(x509.KeyUsageFlags.keyCertSign);
  });

  it("gives the leaf this Mac's name, server authentication and 397 days", async () => {
    const engine = await start();
    await ipadPortOf(engine);
    const leaf = await readCertificate(engine.dataDir, "leaf.pem");
    const ca = await readCertificate(engine.dataDir, "ca.pem");

    expect(leaf.issuer).toBe(ca.subject);
    expect(await leaf.verify({ publicKey: ca.publicKey })).toBe(true);
    expect(leaf.getExtension(x509.SubjectAlternativeNameExtension)?.names.toJSON()).toEqual([{ type: "dns", value: TEST_NAME }]);
    expect(leaf.getExtension(x509.ExtendedKeyUsageExtension)?.usages).toEqual(["1.3.6.1.5.5.7.3.1"]);
    expect(daysLeft(leaf)).toBe(397);
  });

  it("keeps the same authority and leaf across a restart", async () => {
    const first = await start();
    await ipadPortOf(first);
    const before = { ca: await readAuthority(first.dataDir), leaf: await readFile(ipadFile(first.dataDir, "leaf.pem"), "utf8") };
    await first.stop();

    const second = await start({ dataDir: first.dataDir });
    await ipadPortOf(second);
    expect(await readAuthority(second.dataDir)).toBe(before.ca);
    expect(await readFile(ipadFile(second.dataDir, "leaf.pem"), "utf8")).toBe(before.leaf);
  });

  it("makes a new leaf when the Mac was renamed, and keeps the authority the iPad trusts", async () => {
    const first = await start();
    await ipadPortOf(first);
    const authority = await readAuthority(first.dataDir);
    await first.stop();

    const renamed = await start({ dataDir: first.dataDir, name: "renamed-mac.local" });
    await ipadPortOf(renamed);
    const leaf = await readCertificate(renamed.dataDir, "leaf.pem");
    expect(leaf.getExtension(x509.SubjectAlternativeNameExtension)?.names.toJSON()).toEqual([{ type: "dns", value: "renamed-mac.local" }]);
    expect(await readAuthority(renamed.dataDir)).toBe(authority);
  });

  it("renews a leaf whose end is near, without asking the iPad for anything", async () => {
    const first = await start();
    await ipadPortOf(first);
    const authority = await readAuthority(first.dataDir);
    await first.stop();
    await seedExpiringLeaf(first.dataDir, 29);
    expect(daysLeft(await readCertificate(first.dataDir, "leaf.pem"))).toBe(29);

    const second = await start({ dataDir: first.dataDir });
    await ipadPortOf(second);
    expect(daysLeft(await readCertificate(second.dataDir, "leaf.pem"))).toBe(397);
    expect(await readAuthority(second.dataDir)).toBe(authority);
  });

  it("holds an open device socket through the certificate checks", async () => {
    const engine = await start();
    const port = await ipadPortOf(engine);
    const ca = await readAuthority(engine.dataDir);
    const token = await pair(engine, port, ca);
    const socket = deviceSocket(port, ca, "/ws", { token });
    await new Promise<void>((done, fail) => {
      socket.on("open", () => done());
      socket.on("error", fail);
    });
    await new Promise((done) => setTimeout(done, 2500));
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });
});

describe("the iPad profile", () => {
  it("writes a profile holding the authority and reveals it", async () => {
    const engine = await start();
    await ipadPortOf(engine);
    const { path } = await (await engine.rpc()).call("ipad.exportProfile");
    expect(path).toBe(ipadFile(engine.dataDir, `Unframed-${TEST_NAME}.mobileconfig`));

    const profile = await readFile(path, "utf8");
    expect(profile).toContain("com.apple.security.root");
    expect(profile).toContain(`Unframed local CA (${TEST_NAME})`);
    const carried = /<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/.exec(profile)?.[1]?.replace(/\s+/g, "");
    const authority = (await readAuthority(engine.dataDir)).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(carried).toBe(authority);

    await engine.waitForMessage((message) => message.type === "reveal" && message.files.includes(path));
  });
});

const seedExpiringLeaf = async (dataDir: string, days: number): Promise<void> => {
  const caPem = await readFile(ipadFile(dataDir, "ca.pem"), "utf8");
  const caKeyPem = await readFile(ipadFile(dataDir, "ca-key.pem"), "utf8");
  const caKey = await webcrypto.subtle.importKey("pkcs8", der(caKeyPem), ALGORITHM, true, ["sign"]);
  const keys = (await webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: "01",
    subject: `CN=${TEST_NAME}`,
    issuer: new x509.X509Certificate(caPem).subject,
    notBefore: new Date(Date.now() - DAY_MS),
    notAfter: new Date(Date.now() + days * DAY_MS),
    signingKey: caKey,
    publicKey: keys.publicKey,
    signingAlgorithm: ALGORITHM,
    extensions: [new x509.SubjectAlternativeNameExtension([{ type: "dns", value: TEST_NAME }])],
  });
  await writeFile(ipadFile(dataDir, "leaf.pem"), certificate.toString("pem"));
  await writeFile(ipadFile(dataDir, "leaf-key.pem"), pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", keys.privateKey)));
};

const der = (text: string): Buffer => Buffer.from(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
const pem = (label: string, bytes: ArrayBuffer): string =>
  `-----BEGIN ${label}-----\n${Buffer.from(bytes).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;

const pair = async (engine: TestEngine, port: number, ca: string): Promise<string> => {
  const started = await (await engine.rpc()).call("ipad.pairStart");
  const answer = await deviceRequest(port, ca, "/api/ipad/pair", {
    method: "POST",
    body: `code=${started.code}`,
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
  });
  return /unframed_device=([0-9a-f]+)/.exec(String(answer.headers["set-cookie"]?.[0] ?? ""))?.[1] ?? "";
};

