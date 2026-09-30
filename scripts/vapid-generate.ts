import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:tu-correo@dominio.com");
