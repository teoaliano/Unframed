import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { pemBody } from "./certificates.ts";

export const writeProfile = async (dir: string, localName: string, caPem: string): Promise<string> => {
  const path = join(dir, `Unframed-${localName}.mobileconfig`);
  await writeFile(path, profileText(localName, caPem), "utf8");
  return path;
};

export const profileText = (localName: string, caPem: string): string => {
  const payloadUuid = randomUUID().toUpperCase();
  const rootUuid = randomUUID().toUpperCase();
  const certificate = pemBody(caPem).replace(/(.{64})/g, "$1\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadIdentifier</key>
      <string>design.unframed.ipad.ca</string>
      <key>PayloadUUID</key>
      <string>${payloadUuid}</string>
      <key>PayloadDisplayName</key>
      <string>Unframed local CA (${localName})</string>
      <key>PayloadContent</key>
      <data>
${certificate}
      </data>
    </dict>
  </array>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadIdentifier</key>
  <string>design.unframed.ipad</string>
  <key>PayloadUUID</key>
  <string>${rootUuid}</string>
  <key>PayloadDisplayName</key>
  <string>Unframed on ${localName}</string>
  <key>PayloadDescription</key>
  <string>Trusts the certificate Unframed made on ${localName}, so this iPad can open its canvas over your home Wi-Fi.</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
</dict>
</plist>
`;
};
