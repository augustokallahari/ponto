#!/usr/bin/env node
// ===========================================================
// Assina uma atualização OTA de app.js/styles.css com a chave
// privada local e gera o manifest.json que vai pro servidor.
//
// A chave privada NUNCA fica neste repositório nem no servidor —
// fica só na máquina de quem publica as atualizações. Sem ela,
// não é possível gerar uma assinatura válida (nem mesmo com
// acesso total ao servidor).
//
// Uso:
//   node scripts/publicar-atualizacao.js <numero-da-versao>
//
// Depois de rodar, envie os 3 arquivos gerados em
// scripts/saida-publicacao/ para
// /var/www/html/ponto-directory/app-update/ no servidor
// (app.js, styles.css, manifest.json).
// ===========================================================
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CHAVE_PRIVADA_PATH = 'C:/Users/AUGUSTO/pontofacil-signing-key/private.pem';
const WWW_DIR   = path.join(__dirname, '..', 'www');
const SAIDA_DIR = path.join(__dirname, 'saida-publicacao');

const versao = parseInt(process.argv[2], 10);
if (!versao || versao < 1) {
  console.error('Uso: node scripts/publicar-atualizacao.js <numero-da-versao>');
  console.error('Exemplo: node scripts/publicar-atualizacao.js 2');
  process.exit(1);
}

if (!fs.existsSync(CHAVE_PRIVADA_PATH)) {
  console.error(`Chave privada não encontrada em ${CHAVE_PRIVADA_PATH}`);
  process.exit(1);
}

const appJs    = fs.readFileSync(path.join(WWW_DIR, 'app.js'));
const stylesCss = fs.readFileSync(path.join(WWW_DIR, 'styles.css'));

const hashApp = crypto.createHash('sha256').update(appJs).digest('hex');
const hashCss = crypto.createHash('sha256').update(stylesCss).digest('hex');

const payload = `${versao}:${hashApp}:${hashCss}`;
const privateKey = fs.readFileSync(CHAVE_PRIVADA_PATH, 'utf8');

// dsaEncoding 'ieee-p1363' é o formato que o Web Crypto API (SubtleCrypto,
// usado no app) espera para verificar — o padrão do Node é DER (ASN.1),
// que o navegador NÃO entende diretamente.
const assinatura = crypto.sign('sha256', Buffer.from(payload, 'utf8'), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
}).toString('base64');

const manifest = { versao, hash_app: hashApp, hash_css: hashCss, assinatura };

fs.mkdirSync(SAIDA_DIR, { recursive: true });
fs.writeFileSync(path.join(SAIDA_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.copyFileSync(path.join(WWW_DIR, 'app.js'), path.join(SAIDA_DIR, 'app.js'));
fs.copyFileSync(path.join(WWW_DIR, 'styles.css'), path.join(SAIDA_DIR, 'styles.css'));

console.log(`✔ Atualização v${versao} assinada.`);
console.log(`  Arquivos gerados em: ${SAIDA_DIR}`);
console.log('  Envie os 3 arquivos (app.js, styles.css, manifest.json) para');
console.log('  /var/www/html/ponto-directory/app-update/ no servidor.');
