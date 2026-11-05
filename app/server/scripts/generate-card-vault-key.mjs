import { generateKeyPairSync } from 'node:crypto';
import { openSync, writeFileSync, closeSync } from 'node:fs';
import { resolve, basename } from 'node:path';
const output = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
if (!output) throw new Error('Indica --out=/ruta/privada/card-vault.env. No se imprime la clave.');
if (!/^(?:\.env(?:\..+)?|.+\.env)$/.test(basename(output)) || basename(output) === '.env.example') throw new Error('Usa un archivo privado .env, nunca un ejemplo ni un archivo público.');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const fd = openSync(resolve(output), 'wx', 0o600);
try { writeFileSync(fd, `CARD_VAULT_ENABLED=false\nCARD_VAULT_PRIVATE_KEY_B64=${Buffer.from(privateKey).toString('base64')}\n# Definir el plazo aprobado antes de activar (1 a 365 dias).\nCARD_VAULT_RETENTION_DAYS=\n`); }
finally { closeSync(fd); }
process.stdout.write('Configuración privada creada sin mostrar la clave. Mantén el archivo fuera de Git y de la base de datos; revisa sus permisos antes de activar.\n');
