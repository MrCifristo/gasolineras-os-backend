// src/auth/token.service.spec.ts
import { ConfigService } from "@nestjs/config";
import * as jwt from "jsonwebtoken";
import { esperarError } from "../../test/unit/esperar-error";
import {
  AccessClaims,
  ACCESS_TTL_SEGUNDOS,
  JWT_AUD,
  JWT_ISS,
  TokenService,
} from "./token.service";

const MENSAJE_SECRETO =
  "JWT_ACCESS_SECRET debe estar definido y tener al menos 32 caracteres. " +
  "Generá uno con: openssl rand -base64 48";
const SECRETO = "s".repeat(48);

const config = (vars: Record<string, string | undefined>) =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const crear = (secreto: string | undefined = SECRETO) => {
  const s = new TokenService(config({ JWT_ACCESS_SECRET: secreto }));
  s.onModuleInit();
  return s;
};

const claims: AccessClaims = {
  sub: "u1",
  rol: "admin",
  gasolinera_id: null,
  cliente_id: null,
  sid: "sid-1",
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("TokenService", () => {
  afterEach(() => jest.useRealTimers());

  it("no arranca sin secreto", () => {
    const s = new TokenService(config({}));
    esperarError(() => s.onModuleInit(), Error, MENSAJE_SECRETO);
  });

  it("no arranca con un secreto de 31 caracteres", () => {
    const s = new TokenService(config({ JWT_ACCESS_SECRET: "x".repeat(31) }));
    esperarError(() => s.onModuleInit(), Error, MENSAJE_SECRETO);
  });

  it("arranca con un secreto de exactamente 32 caracteres", () => {
    const s = new TokenService(config({ JWT_ACCESS_SECRET: "x".repeat(32) }));
    expect(() => s.onModuleInit()).not.toThrow();
  });

  it("firmar y verificar devuelve los mismos claims, con iss y aud", () => {
    const s = crear();
    const resultado = s.verificarAccess(s.firmarAccess(claims));
    expect(resultado).toMatchObject(claims);
    expect(resultado).toMatchObject({ iss: JWT_ISS, aud: JWT_AUD });
  });

  it("otro secreto da null, sin lanzar", () => {
    const token = crear().firmarAccess(claims);
    expect(crear("o".repeat(48)).verificarAccess(token)).toBeNull();
  });

  it("vale a los 14:59 y es null a los 15:01", () => {
    jest.useFakeTimers({ now: new Date("2026-10-07T12:00:00Z") });
    const s = crear();
    const token = s.firmarAccess(claims);
    expect(ACCESS_TTL_SEGUNDOS).toBe(900);

    jest.setSystemTime(new Date("2026-10-07T12:14:59Z"));
    expect(s.verificarAccess(token)).not.toBeNull();

    jest.setSystemTime(new Date("2026-10-07T12:15:01Z"));
    expect(s.verificarAccess(token)).toBeNull();
  });

  it("un token alg:none armado a mano da null", () => {
    const s = crear();
    const ahora = Math.floor(Date.now() / 1000);
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      ...claims,
      iss: JWT_ISS,
      aud: JWT_AUD,
      exp: ahora + 600,
    })}.`;
    expect(s.verificarAccess(token)).toBeNull();
  });

  it("otra audiencia da null", () => {
    const s = crear();
    const token = jwt.sign(claims, SECRETO, {
      algorithm: "HS256",
      expiresIn: 600,
      issuer: JWT_ISS,
      audience: "otra-app",
    });
    expect(s.verificarAccess(token)).toBeNull();
  });

  it("otro emisor da null", () => {
    const s = crear();
    const token = jwt.sign(claims, SECRETO, {
      algorithm: "HS256",
      expiresIn: 600,
      issuer: "otro-emisor",
      audience: JWT_AUD,
    });
    expect(s.verificarAccess(token)).toBeNull();
  });

  it("basura da null, sin lanzar", () => {
    const s = crear();
    expect(s.verificarAccess("esto-no-es-un-jwt")).toBeNull();
    expect(s.verificarAccess("")).toBeNull();
  });
});
