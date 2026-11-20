import crypto from "node:crypto";
const kp = crypto.generateKeyPairSync("ed25519");
const priv = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pub = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
console.log("# Add to your environment (base64 of the PEM is accepted):");
console.log(`SIGNING_PRIVATE_KEY=${Buffer.from(priv).toString("base64")}`);
console.log(`SIGNING_PUBLIC_KEY=${Buffer.from(pub).toString("base64")}`);
