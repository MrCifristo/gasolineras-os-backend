import 'dotenv/config';
import * as readline from 'readline';
import { hash } from '@node-rs/argon2';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { usuarios } from '../src/db/schema';

// Mismos parámetros que PasswordService. Este script no puede levantar el
// contexto de Nest, así que se duplican; si allá cambian, acá también.
// Argon2id === 2 en el const enum de @node-rs/argon2 (no importable acá).
const ARGON2 = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    (stdin as any).setRawMode(true);
    stdin.resume();
    let pw = '';
    const handler = (ch: Buffer) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        (stdin as any).setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(pw);
      } else if (c === '') {
        process.exit();
      } else if (c === '') {
        pw = pw.slice(0, -1);
      } else {
        pw += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', handler);
  });
}

/**
 * Sin TTY (CI, first-start.sh no interactivo) toma los datos del entorno.
 * Esa ausencia es justamente lo que llevó a que una contraseña real terminara
 * hardcodeada en la suite e2e.
 */
async function obtenerDatos() {
  const desdeEnv = process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD;
  if (desdeEnv || !process.stdin.isTTY) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const nombre = process.env.ADMIN_NOMBRE ?? 'Administrador';
    if (!email || !password) {
      console.error(
        '❌ Sin terminal interactiva hay que pasar ADMIN_EMAIL y ADMIN_PASSWORD por entorno.',
      );
      process.exit(1);
    }
    return { nombre, email, password };
  }

  console.log('\n🔧 Bootstrap de admin — GASFUEL OS\n');
  return {
    nombre: await ask('Nombre completo: '),
    email: await ask('Email: '),
    password: await askPassword('Contraseña (mín. 8 caracteres): '),
  };
}

async function main() {
  const { nombre, email, password } = await obtenerDatos();

  if (!nombre || !email || password.length < 8) {
    console.error('❌ Datos inválidos: falta nombre/email o la contraseña tiene menos de 8 caracteres.');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ Falta DATABASE_URL.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  try {
    const emailNormalizado = email.toLowerCase();
    const passwordHash = await hash(password, ARGON2);

    const [existente] = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, emailNormalizado))
      .limit(1);

    // Reestablecer la contraseña acá es deliberado: este script es el modo de
    // recuperar el acceso cuando nadie puede entrar.
    if (existente) {
      const [row] = await db
        .update(usuarios)
        .set({
          password_hash: passwordHash,
          password_actualizado_at: new Date(),
          rol: 'admin',
          activo: true,
        })
        .where(eq(usuarios.id, existente.id))
        .returning({ id: usuarios.id, email: usuarios.email, rol: usuarios.rol });

      console.log('\n✅ El admin ya existía: se actualizó su contraseña.');
      console.log(`   ID    : ${row.id}`);
      console.log(`   Email : ${row.email}`);
      console.log(`   Rol   : ${row.rol}`);
    } else {
      const [row] = await db
        .insert(usuarios)
        .values({
          email: emailNormalizado,
          nombre,
          password_hash: passwordHash,
          rol: 'admin',
          activo: true,
        })
        .returning({ id: usuarios.id, email: usuarios.email, rol: usuarios.rol });

      console.log('\n✅ Admin creado:');
      console.log(`   ID    : ${row.id}`);
      console.log(`   Email : ${row.email}`);
      console.log(`   Rol   : ${row.rol}`);
    }

    console.log('\n🚀 Ya podés hacer login en la API con estas credenciales.\n');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
