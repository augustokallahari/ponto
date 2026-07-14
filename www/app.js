// ===========================================================
// PontoFácil — app self-service (Capacitor)
// Pareamento único por aparelho, reconhecimento facial offline,
// fila de sincronização quando a conexão volta.
// ===========================================================

// Único endereço fixo no app: o diretório central, que nunca muda porque é o
// domínio do próprio revendedor. Toda instalação de cliente (empresa) registra
// sua própria URL aqui através da tela de Configurações > Módulo Web.
const DIRETORIO_URL = 'https://kallahari.com.br/ponto-directory/resolver.php';
const REVALIDAR_EMPRESA_A_CADA_MS = 6 * 60 * 60 * 1000; // 6 horas

const LS_CODIGO_EMPRESA = 'pf_codigo_empresa';
const LS_API_BASE       = 'pf_api_base';
const LS_EMPRESA_NOME   = 'pf_empresa_nome';
const LS_EMPRESA_REVALIDADA_EM = 'pf_empresa_revalidada_em';

const LS_FUNCIONARIO   = 'pf_funcionario';
const LS_DESCRIPTORS   = 'pf_descriptors';
const LS_FILA          = 'pf_fila_pendente';
const LS_HOJE          = 'pf_hoje_local';

let API_BASE = null; // definido dinamicamente após resolver o código da empresa

const SEQUENCIA = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
const NOMES_TIPO = {
  entrada: 'Entrada',
  saida_almoco: 'Saída Almoço',
  retorno_almoco: 'Retorno Almoço',
  saida: 'Saída',
};

let funcionario = null;
let descriptorsLocais = [];
let filaPendente = [];
let hojeLocal = null;
let ultimaPosicao = null;
let modeloCarregado = false;
let detectando = false;
let streamAtivo = null;

// ---------- utilidades ----------
function hoje() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function horaAgora() {
  return new Date().toTimeString().slice(0, 8);
}
function lerJSON(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; }
  catch { return padrao; }
}
function salvarJSON(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));
}
function mostrarToast(msg, tipo = 'sucesso') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${tipo}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('oculto'), 3500);
}
function distanciaEuclidiana(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let soma = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; soma += d * d; }
  return Math.sqrt(soma);
}

// ---------- inicialização ----------
document.addEventListener('DOMContentLoaded', init);

async function init() {
  API_BASE = lerJSON(LS_API_BASE, null);
  funcionario = lerJSON(LS_FUNCIONARIO, null);
  descriptorsLocais = lerJSON(LS_DESCRIPTORS, []);
  filaPendente = lerJSON(LS_FILA, []);
  hojeLocal = lerJSON(LS_HOJE, null);
  if (!hojeLocal || hojeLocal.data !== hoje()) {
    hojeLocal = { data: hoje(), entrada: null, saida_almoco: null, retorno_almoco: null, saida: null };
    salvarJSON(LS_HOJE, hojeLocal);
  }

  setInterval(atualizarRelogio, 1000);
  atualizarRelogio();

  if (!API_BASE) {
    mostrarTelaCodigoEmpresa();
  } else if (funcionario) {
    mostrarTelaPrincipal();
  } else {
    mostrarTelaPareamento();
  }

  // gatilhos de sincronização
  window.addEventListener('online', tentarSincronizar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tentarSincronizar();
  });
  setInterval(tentarSincronizar, 60000);

  if (window.Capacitor?.Plugins?.Network) {
    window.Capacitor.Plugins.Network.addListener('networkStatusChange', (status) => {
      if (status.connected) tentarSincronizar();
    });
  }
  if (window.Capacitor?.Plugins?.App) {
    window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) tentarSincronizar();
    });
  }

  tentarSincronizar();
}

function atualizarRelogio() {
  const d = new Date();
  const relogioEl = document.getElementById('relogio');
  if (relogioEl) relogioEl.textContent = d.toTimeString().slice(0, 8);
  const dataEl = document.getElementById('data-hoje');
  if (dataEl) {
    dataEl.textContent = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
  }
}

// ===========================================================
// TELA 0 — CÓDIGO DA EMPRESA
// ===========================================================
function mostrarTelaCodigoEmpresa() {
  document.getElementById('tela-codigo-empresa').classList.remove('oculto');
  document.getElementById('tela-pareamento').classList.add('oculto');
  document.getElementById('tela-principal').classList.add('oculto');
  document.getElementById('tela-cadastro-facial').classList.add('oculto');

  const input = document.getElementById('input-codigo-empresa');
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  document.getElementById('btn-confirmar-codigo-empresa').addEventListener('click', () => {
    confirmarCodigoEmpresa(input.value.trim());
  });
}

async function confirmarCodigoEmpresa(codigo) {
  const erroEl = document.getElementById('erro-codigo-empresa');
  const btn = document.getElementById('btn-confirmar-codigo-empresa');
  erroEl.classList.add('oculto');

  if (codigo.length !== 6) {
    erroEl.textContent = 'O código tem 6 caracteres.';
    erroEl.classList.remove('oculto');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const r = await fetch(`${DIRETORIO_URL}?codigo=${encodeURIComponent(codigo)}`);
    const data = await r.json();
    if (!data.ok) {
      throw new Error(data.erro || 'Código não encontrado');
    }
    salvarJSON(LS_CODIGO_EMPRESA, codigo);
    salvarJSON(LS_API_BASE, data.api_base);
    salvarJSON(LS_EMPRESA_NOME, data.nome || '');
    salvarJSON(LS_EMPRESA_REVALIDADA_EM, Date.now());
    API_BASE = data.api_base;
    mostrarTelaPareamento();
  } catch (e) {
    erroEl.textContent = 'Não foi possível confirmar este código. Verifique sua conexão e o código digitado.';
    erroEl.classList.remove('oculto');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continuar';
  }
}

// Reconsulta o diretório central em segundo plano pra pegar mudanças de URL da
// empresa sem exigir que o funcionário digite o código de novo.
async function revalidarEmpresa() {
  const codigo = lerJSON(LS_CODIGO_EMPRESA, null);
  if (!codigo || navigator.onLine === false) return;

  const ultimaRevalidacao = lerJSON(LS_EMPRESA_REVALIDADA_EM, 0);
  if (Date.now() - ultimaRevalidacao < REVALIDAR_EMPRESA_A_CADA_MS) return;

  try {
    const r = await fetch(`${DIRETORIO_URL}?codigo=${encodeURIComponent(codigo)}`);
    const data = await r.json();
    if (data.ok && data.api_base && data.api_base !== API_BASE) {
      API_BASE = data.api_base;
      salvarJSON(LS_API_BASE, data.api_base);
      salvarJSON(LS_EMPRESA_NOME, data.nome || '');
    }
    salvarJSON(LS_EMPRESA_REVALIDADA_EM, Date.now());
  } catch (e) {
    // sem conexão ou diretório fora do ar — tenta de novo na próxima sincronização
  }
}

function trocarEmpresa() {
  if (!confirm('Trocar de empresa? Você vai precisar digitar o código da empresa e buscar seu nome de novo.')) return;
  localStorage.removeItem(LS_CODIGO_EMPRESA);
  localStorage.removeItem(LS_API_BASE);
  localStorage.removeItem(LS_EMPRESA_NOME);
  localStorage.removeItem(LS_EMPRESA_REVALIDADA_EM);
  localStorage.removeItem(LS_FUNCIONARIO);
  localStorage.removeItem(LS_DESCRIPTORS);
  location.reload();
}

// ===========================================================
// TELA 1 — PAREAMENTO
// ===========================================================
function mostrarTelaPareamento() {
  document.getElementById('tela-codigo-empresa').classList.add('oculto');
  document.getElementById('tela-pareamento').classList.remove('oculto');
  document.getElementById('tela-principal').classList.add('oculto');
  document.getElementById('tela-cadastro-facial').classList.add('oculto');

  const input = document.getElementById('input-busca');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => buscarFuncionario(input.value.trim()), 350);
  });

  document.getElementById('btn-cancelar-pareamento').addEventListener('click', () => {
    document.getElementById('confirmacao-pareamento').classList.add('oculto');
  });

  document.getElementById('btn-pular-facial').addEventListener('click', () => {
    mostrarTelaPrincipal();
  });
}

let candidatoPareamento = null;

async function buscarFuncionario(q) {
  const lista = document.getElementById('resultados-busca');
  const erroEl = document.getElementById('erro-pareamento');
  erroEl.classList.add('oculto');
  lista.innerHTML = '';
  if (q.length < 2) return;

  try {
    const r = await fetch(`${API_BASE}buscar_funcionario.php?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    const funcionarios = data.funcionarios || [];
    if (funcionarios.length === 0) {
      lista.innerHTML = '<p class="muted" style="padding:8px">Nenhum funcionário encontrado.</p>';
      return;
    }
    funcionarios.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'resultado-item';
      div.innerHTML = `<div class="nome">${escapeHtml(f.nome)}</div>
                        <div class="cargo">${escapeHtml(f.cargo || '')} ${f.departamento ? '· ' + escapeHtml(f.departamento) : ''}</div>`;
      div.addEventListener('click', () => selecionarCandidato(f));
      lista.appendChild(div);
    });
  } catch (e) {
    erroEl.textContent = 'Sem conexão. É preciso estar online para vincular o celular pela primeira vez.';
    erroEl.classList.remove('oculto');
  }
}

function selecionarCandidato(f) {
  candidatoPareamento = f;
  document.getElementById('nome-confirmar').textContent = f.nome;
  document.getElementById('cargo-confirmar').textContent = [f.cargo, f.departamento].filter(Boolean).join(' · ');
  document.getElementById('confirmacao-pareamento').classList.remove('oculto');

  document.getElementById('btn-confirmar-pareamento').onclick = confirmarPareamento;
}

async function confirmarPareamento() {
  const erroEl = document.getElementById('erro-pareamento');
  const btn = document.getElementById('btn-confirmar-pareamento');
  btn.disabled = true;
  btn.textContent = 'Vinculando...';

  try {
    // Busca os descritores faciais de todos e filtra o do funcionário escolhido.
    const r = await fetch(`${API_BASE}get_descriptors.php`);
    const data = await r.json();
    const registro = (data.funcionarios || []).find((f) => String(f.id) === String(candidatoPareamento.id));

    funcionario = candidatoPareamento;
    salvarJSON(LS_FUNCIONARIO, funcionario);

    if (registro && registro.descriptors && registro.descriptors.length > 0) {
      descriptorsLocais = registro.descriptors;
      salvarJSON(LS_DESCRIPTORS, descriptorsLocais);
      mostrarTelaPrincipal();
    } else {
      // Sem rosto cadastrado ainda — avisa e deixa continuar (vai poder usar quando o admin cadastrar).
      document.getElementById('tela-pareamento').classList.add('oculto');
      document.getElementById('tela-cadastro-facial').classList.remove('oculto');
    }
  } catch (e) {
    erroEl.textContent = 'Falha ao vincular. Verifique sua conexão e tente novamente.';
    erroEl.classList.remove('oculto');
    btn.disabled = false;
    btn.textContent = 'Sim, sou eu';
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

// ===========================================================
// TELA 2 — PRINCIPAL
// ===========================================================
async function mostrarTelaPrincipal() {
  document.getElementById('tela-codigo-empresa').classList.add('oculto');
  document.getElementById('tela-pareamento').classList.add('oculto');
  document.getElementById('tela-cadastro-facial').classList.add('oculto');
  document.getElementById('tela-principal').classList.remove('oculto');

  document.getElementById('nome-funcionario').textContent = funcionario.nome;
  document.getElementById('btn-sync-manual').addEventListener('click', tentarSincronizar);
  document.getElementById('btn-desvincular').addEventListener('click', desvincularAparelho);
  document.getElementById('btn-trocar-empresa').addEventListener('click', trocarEmpresa);

  atualizarResumoHoje();
  atualizarBadgePendencias();
  iniciarGPS();
  await iniciarCamera();
  await carregarModelosFaceApi();

  document.getElementById('btn-bater-ponto').addEventListener('click', baterPonto);
  atualizarBotaoPrincipal();
}

function desvincularAparelho() {
  if (!confirm('Desvincular este celular? Você vai precisar buscar seu nome novamente da próxima vez.')) return;
  localStorage.removeItem(LS_FUNCIONARIO);
  localStorage.removeItem(LS_DESCRIPTORS);
  location.reload();
}

function proximoTipo() {
  if (hojeLocal.data !== hoje()) {
    hojeLocal = { data: hoje(), entrada: null, saida_almoco: null, retorno_almoco: null, saida: null };
    salvarJSON(LS_HOJE, hojeLocal);
  }
  return SEQUENCIA.find((t) => !hojeLocal[t]) || null;
}

function atualizarBotaoPrincipal() {
  const btn = document.getElementById('btn-bater-ponto');
  const tipo = proximoTipo();
  if (!tipo) {
    btn.textContent = 'Todos os pontos de hoje já foram batidos ✓';
    btn.disabled = true;
    return;
  }
  btn.textContent = `Bater ${NOMES_TIPO[tipo]}`;
  btn.disabled = !modeloCarregado;
}

function atualizarResumoHoje() {
  const el = document.getElementById('resumo-hoje');
  const idsPendentesPorTipo = new Set(filaPendente.map((p) => p.tipo));
  el.innerHTML = SEQUENCIA.map((t) => {
    const feito = !!hojeLocal[t];
    const pendente = idsPendentesPorTipo.has(t);
    const cls = pendente ? 'pendente-sync' : (feito ? 'feito' : '');
    const valor = feito ? hojeLocal[t].slice(0, 5) : '--:--';
    return `<div class="item ${cls}"><span>${valor}</span><span>${NOMES_TIPO[t]}</span></div>`;
  }).join('');
}

function atualizarBadgePendencias() {
  const badge = document.getElementById('badge-pendencias');
  const qtd = document.getElementById('qtd-pendencias');
  if (filaPendente.length > 0) {
    qtd.textContent = filaPendente.length;
    badge.classList.remove('oculto');
  } else {
    badge.classList.add('oculto');
  }
}

// ---------- GPS ----------
function iniciarGPS() {
  const bar = document.getElementById('gps-bar');
  if (!navigator.geolocation) {
    bar.textContent = '📍 GPS não disponível neste aparelho';
    bar.className = 'gps-bar erro';
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      ultimaPosicao = pos.coords;
      bar.textContent = `📍 Localização obtida (±${Math.round(pos.coords.accuracy)}m)`;
      bar.className = 'gps-bar ok';
    },
    (err) => {
      bar.textContent = '📍 Ative o GPS para bater o ponto';
      bar.className = 'gps-bar erro';
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
}

function obterGPSAtual() {
  return new Promise((resolve, reject) => {
    if (ultimaPosicao) { resolve(ultimaPosicao); return; }
    if (!navigator.geolocation) { reject(new Error('GPS não disponível')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

// ---------- Câmera + reconhecimento facial ----------
async function iniciarCamera() {
  const video = document.getElementById('video');
  try {
    streamAtivo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 480, height: 640 },
    });
    video.srcObject = streamAtivo;
  } catch (e) {
    document.getElementById('status-camera').textContent = 'Não foi possível acessar a câmera. Verifique as permissões do app.';
    document.getElementById('status-camera').className = 'status-camera erro';
  }
}

async function carregarModelosFaceApi() {
  const statusEl = document.getElementById('status-camera');
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('./models');
    await faceapi.nets.faceRecognitionNet.loadFromUri('./models');
    modeloCarregado = true;
    statusEl.textContent = 'Pronto. Toque no botão para bater o ponto.';
    statusEl.className = 'status-camera aguardando';
  } catch (e) {
    statusEl.textContent = 'Falha ao carregar reconhecimento facial.';
    statusEl.className = 'status-camera erro';
  }
  atualizarBotaoPrincipal();
}

async function detectarRosto(timeoutMs = 12000) {
  const video = document.getElementById('video');
  const statusEl = document.getElementById('status-camera');
  const scanLine = document.getElementById('scan-line');
  scanLine.classList.add('ativo');
  statusEl.textContent = 'Posicione seu rosto na câmera...';
  statusEl.className = 'status-camera detectando';

  const inicio = Date.now();
  const opcoes = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

  while (Date.now() - inicio < timeoutMs) {
    const deteccao = await faceapi
      .detectSingleFace(video, opcoes)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (deteccao) {
      scanLine.classList.remove('ativo');
      return deteccao.descriptor;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  scanLine.classList.remove('ativo');
  throw new Error('Não foi possível detectar seu rosto. Tente novamente.');
}

function capturarFoto() {
  const video = document.getElementById('video');
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

// ---------- Bater ponto ----------
async function baterPonto() {
  const tipo = proximoTipo();
  if (!tipo) return;

  const btn = document.getElementById('btn-bater-ponto');
  const statusEl = document.getElementById('status-camera');
  btn.disabled = true;

  try {
    let descriptorArray = null;

    if (descriptorsLocais.length > 0) {
      const descriptorDetectado = await detectarRosto();
      const distancias = descriptorsLocais.map((d) => distanciaEuclidiana(Array.from(descriptorDetectado), d));
      const menorDistancia = Math.min(...distancias);
      if (menorDistancia > 0.5) {
        throw new Error('Rosto não confere com o cadastro. Tente novamente.');
      }
      descriptorArray = Array.from(descriptorDetectado);
      statusEl.textContent = 'Rosto identificado ✓';
      statusEl.className = 'status-camera identificado';
    }

    const coords = await obterGPSAtual().catch(() => null);
    if (!coords) {
      throw new Error('Localização GPS não disponível. Ative o GPS e tente novamente.');
    }

    const registro = {
      uid: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      funcionario_id: funcionario.id,
      tipo,
      metodo: descriptorArray ? 'facial' : 'manual',
      foto: capturarFoto(),
      latitude: coords.latitude,
      longitude: coords.longitude,
      descriptor: descriptorArray,
      data: hoje(),
      hora: horaAgora(),
    };

    await enviarOuEnfileirar(registro);

  } catch (e) {
    mostrarToast(e.message || 'Erro ao bater o ponto', 'erro');
    statusEl.textContent = e.message || 'Erro ao bater o ponto';
    statusEl.className = 'status-camera erro';
  } finally {
    atualizarBotaoPrincipal();
  }
}

async function enviarOuEnfileirar(registro) {
  const enviado = await tentarEnviar(registro);

  // Sempre atualiza o estado local do dia — o funcionário já bateu o ponto
  // fisicamente, esteja online ou não.
  hojeLocal[registro.tipo] = registro.hora;
  salvarJSON(LS_HOJE, hojeLocal);

  if (enviado === 'ok') {
    mostrarToast(`${NOMES_TIPO[registro.tipo]} registrada às ${registro.hora.slice(0, 5)} ✓`, 'sucesso');
  } else if (enviado === 'duplicado') {
    mostrarToast(`${NOMES_TIPO[registro.tipo]} já estava registrada.`, 'sucesso');
  } else {
    filaPendente.push(registro);
    salvarJSON(LS_FILA, filaPendente);
    mostrarToast('Sem conexão — ponto salvo no aparelho e será sincronizado automaticamente.', 'offline');
  }

  atualizarResumoHoje();
  atualizarBadgePendencias();
}

// Retorna 'ok' | 'duplicado' | 'offline'
async function tentarEnviar(registro) {
  if (navigator.onLine === false) return 'offline';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch(`${API_BASE}registrar_ponto.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registro),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await r.json();
    if (data.ok) return 'ok';
    if (data.erro && /já foi registrado/i.test(data.erro)) return 'duplicado';
    // outro erro de validação (ex: rosto não confere, fora de sequência) —
    // não faz sentido reenfileirar, mas também não é sucesso.
    throw new Error(data.erro || 'Erro ao registrar ponto');
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) return 'offline';
    throw e;
  }
}

// ---------- Sincronização da fila ----------
let sincronizando = false;
async function tentarSincronizar() {
  revalidarEmpresa();

  if (sincronizando || filaPendente.length === 0) return;
  if (navigator.onLine === false) return;
  sincronizando = true;

  const restante = [];
  for (const registro of filaPendente) {
    try {
      const resultado = await tentarEnviar(registro);
      if (resultado === 'offline') {
        restante.push(registro);
      }
      // 'ok' e 'duplicado' => descarta da fila (já processado no servidor)
    } catch (e) {
      // erro de validação definitivo (ex: rosto não confere) — descarta pra não travar a fila,
      // mas avisa o usuário.
      mostrarToast(`Falha ao sincronizar ${NOMES_TIPO[registro.tipo] || registro.tipo}: ${e.message}`, 'erro');
    }
  }
  filaPendente = restante;
  salvarJSON(LS_FILA, filaPendente);
  atualizarBadgePendencias();
  if (typeof atualizarResumoHoje === 'function' && document.getElementById('resumo-hoje')) {
    atualizarResumoHoje();
  }
  if (restante.length === 0 && document.getElementById('badge-pendencias')) {
    // nada a avisar, badge já esconde sozinho
  }

  sincronizando = false;
}
