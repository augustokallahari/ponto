// ===========================================================
// PontoFácil — carregador com atualização OTA assinada (sem
// precisar gerar um APK novo pra cada correção de lógica/visual).
//
// Como funciona:
// 1. Carrega app.js/styles.css do CACHE local (localStorage) se já
//    existir; senão usa os arquivos empacotados no próprio APK
//    (www/app.js, www/styles.css) como base inicial.
// 2. Em segundo plano, se online, busca um manifest.json assinado
//    digitalmente no servidor. A assinatura só pode ser gerada por
//    quem tem a chave PRIVADA (guardada fora do servidor, só na
//    máquina de quem publica) — a chave PÚBLICA abaixo só consegue
//    CONFERIR assinaturas, nunca criar. Isso significa que mesmo que
//    alguém consiga escrever nesses arquivos por uma falha em outro
//    sistema hospedado no mesmo servidor, o app rejeita a
//    atualização adulterada (assinatura não bate) em vez de rodá-la.
// 3. Só troca de versão na PRÓXIMA abertura do app — nunca no meio
//    do uso.
//
// Este arquivo (loader.js) é a única parte que fica fixa e só muda
// com um novo APK — o resto (app.js e styles.css) pode ser
// atualizado remotamente, desde que assinado com a chave privada.
// ===========================================================
(function () {
  const UPDATE_BASE = 'https://kallahari.com.br/ponto-directory/app-update/distribuir.php?arquivo=';
  const LS_VERSAO = 'pf_app_versao';
  const LS_JS     = 'pf_app_js_cache';
  const LS_CSS    = 'pf_app_css_cache';

  // Chave pública (JWK) usada só para CONFERIR assinaturas — não serve pra
  // assinar nada. A chave privada correspondente nunca sai da máquina de
  // quem publica atualizações.
  const CHAVE_PUBLICA_JWK = {
    kty: 'EC',
    crv: 'P-256',
    x: 'IT4rEaZOOxY0dSiTKMZWJAU3Ry-rLtnzxqDThqz9Ar8',
    y: 'katZMW0mqgb85pLQl-ZXVqGKtB7ArEi_Eaw0Mh-yeD0',
  };

  function carregarCss(texto) {
    const style = document.createElement('style');
    style.textContent = texto;
    document.head.appendChild(style);
  }

  function carregarJs(texto) {
    const blob = new Blob([texto], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = url;
    document.body.appendChild(script);
  }

  async function sha256Hex(texto) {
    const bytes = new TextEncoder().encode(texto);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function base64ParaBytes(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function verificarAssinatura(payload, assinaturaBase64) {
    try {
      const chave = await crypto.subtle.importKey(
        'jwk', CHAVE_PUBLICA_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      );
      const dados = new TextEncoder().encode(payload);
      const assinatura = base64ParaBytes(assinaturaBase64);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, chave, assinatura, dados);
    } catch (e) {
      console.error('[PontoFácil] Falha ao verificar assinatura da atualização:', e);
      return false;
    }
  }

  async function iniciar() {
    let cssTexto = localStorage.getItem(LS_CSS);
    let jsTexto  = localStorage.getItem(LS_JS);

    // Primeiríssima abertura: ainda não existe nada em cache — usa os
    // arquivos empacotados no APK como ponto de partida (versão 0). Esses
    // já vieram dentro do APK, então não precisam de assinatura (o próprio
    // APK, esse sim, tem a assinatura da Play Store / do processo de build).
    if (!cssTexto || !jsTexto) {
      try {
        [cssTexto, jsTexto] = await Promise.all([
          fetch('styles.css').then((r) => r.text()),
          fetch('app.js').then((r) => r.text()),
        ]);
        localStorage.setItem(LS_CSS, cssTexto);
        localStorage.setItem(LS_JS, jsTexto);
        if (!localStorage.getItem(LS_VERSAO)) localStorage.setItem(LS_VERSAO, '0');
      } catch (e) {
        console.error('[PontoFácil] Falha ao carregar arquivos base do app:', e);
      }
    }

    if (cssTexto) carregarCss(cssTexto);
    if (jsTexto) carregarJs(jsTexto);

    verificarAtualizacao();
  }

  async function verificarAtualizacao() {
    if (navigator.onLine === false) return;
    try {
      const manifest = await fetch(UPDATE_BASE + 'manifest', { cache: 'no-store' }).then((r) => r.json());
      const versaoAtual = parseInt(localStorage.getItem(LS_VERSAO) || '0', 10);
      if (!manifest || !manifest.versao || !(manifest.versao > versaoAtual)) return;

      const payload = `${manifest.versao}:${manifest.hash_app}:${manifest.hash_css}`;
      const assinaturaValida = await verificarAssinatura(payload, manifest.assinatura);
      if (!assinaturaValida) {
        console.warn('[PontoFácil] Atualização recebida com assinatura inválida — ignorada.');
        return;
      }

      const [css, js] = await Promise.all([
        fetch(UPDATE_BASE + 'css', { cache: 'no-store' }).then((r) => r.text()),
        fetch(UPDATE_BASE + 'app', { cache: 'no-store' }).then((r) => r.text()),
      ]);

      const [hashCssReal, hashJsReal] = await Promise.all([sha256Hex(css), sha256Hex(js)]);
      if (hashCssReal !== manifest.hash_css || hashJsReal !== manifest.hash_app) {
        console.warn('[PontoFácil] Atualização recebida com conteúdo diferente do assinado — ignorada.');
        return;
      }

      localStorage.setItem(LS_CSS, css);
      localStorage.setItem(LS_JS, js);
      localStorage.setItem(LS_VERSAO, String(manifest.versao));
      console.log(`[PontoFácil] Atualização (v${manifest.versao}) verificada e baixada — será aplicada na próxima abertura do app.`);
    } catch (e) {
      // sem conexão ou servidor de atualização fora do ar — tenta de novo depois
    }
  }

  iniciar();
})();
