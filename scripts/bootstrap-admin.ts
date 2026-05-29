import 'dotenv/config';
import * as readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { usuarios } from '../src/db/schema';

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

async function main() {
  console.log('\n🔧 Bootstrap de admin — GASFUEL OS\n');

  const nombre   = await ask('Nombre completo: ');
  const email    = await ask('Email: ');
  const password = await askPassword('Contraseña (mín. 8 caracteres): ');

  if (!nombre || !email || password.length < 8) {
    console.error('❌ Datos inválidos.');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl       = process.env.DATABASE_URL;

  if (!supabaseUrl || !serviceKey || !dbUrl) {
    console.error('❌ Faltan variables de entorno (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL).');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('\n⏳ Creando cuenta en Supabase Auth...');
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message.includes('already registered') || authError.message.includes('already been registered')) {
      console.log('⚠️  El email ya existe en Supabase Auth, buscando usuario existente...');
      const listResult = await supabase.auth.admin.listUsers();
      const allUsers: { id: string; email?: string }[] = listResult.data?.users ?? [];
      const existing = allUsers.find((u) => u.email === email);
      if (!existing) {
        console.error('❌ No se pudo obtener el usuario existente de Supabase.');
        process.exit(1);
      }
      await insertLocal(dbUrl, existing.id, email, nombre);
    } else {
      console.error(`❌ Error en Supabase Auth: ${authError.message}`);
      process.exit(1);
    }
  } else {
    console.log(`✅ Usuario creado en Supabase Auth: ${authData.user.id}`);
    await insertLocal(dbUrl, authData.user.id, email, nombre);
  }

  process.exit(0);
}

async function insertLocal(dbUrl: string, supabaseUserId: string, email: string, nombre: string) {
  console.log('⏳ Insertando en base de datos local...');
  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  const [row] = await db
    .insert(usuarios)
    .values({ supabase_user_id: supabaseUserId, email, nombre, rol: 'admin', activo: true })
    .onConflictDoNothing()
    .returning();

  await pool.end();

  if (!row) {
    console.log('⚠️  El usuario ya existía en la base de datos local.');
  } else {
    console.log('\n✅ Admin creado exitosamente:');
    console.log(`   ID interno : ${row.id}`);
    console.log(`   Supabase ID: ${row.supabase_user_id}`);
    console.log(`   Email      : ${row.email}`);
    console.log(`   Rol        : ${row.rol}`);
  }
  console.log('\n🚀 Ya puedes hacer login en la API con estas credenciales.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
