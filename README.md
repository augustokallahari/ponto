# PontoFácil — App Android (self-service, offline-first, multi-empresa)

App Android para os funcionários baterem o próprio ponto pelo celular, com reconhecimento facial e
GPS, funcionando **offline** e sincronizando automaticamente assim que a conexão voltar. Um único APK
serve **qualquer empresa** que use o sistema PontoFácil — cada uma com seu próprio "Código da Empresa".

## Como funciona

0. **Código da Empresa** (só na primeiríssima abertura do app): o funcionário digita o código de 6
   caracteres fornecido pelo administrador (gerado em Configurações > Módulo Web, no painel web da
   empresa). O app consulta um diretório central (`kallahari.com.br/ponto-directory`) que devolve o
   endereço do servidor daquela empresa especificamente — assim o mesmo APK funciona pra qualquer
   cliente, e se o endereço de uma empresa mudar (troca de domínio/pasta), os celulares já instalados
   descobrem o endereço novo sozinhos, sem precisar digitar o código de novo.
1. **Primeira vez (por funcionário)**: busca o próprio nome (precisa estar online), confirma quem é, e o
   app vincula esse celular a ele permanentemente. O reconhecimento facial já cadastrado no sistema é
   baixado e guardado no aparelho.
2. **Uso do dia a dia**: toca no botão, o app reconhece o rosto (offline, usando o que foi salvo no
   passo 1), pega a localização GPS e registra o ponto.
   - **Com internet**: envia direto pro servidor.
   - **Sem internet**: guarda no celular com a hora exata em que foi batido, mostra "pendente de
     sincronização", e envia sozinho assim que a conexão voltar (ou quando o app é reaberto).

## Estrutura

- `www/` — a web app em si (HTML/CSS/JS). É a fonte de verdade; qualquer mudança de lógica ou visual
  é feita aqui.
- `android/` — projeto nativo gerado pelo [Capacitor](https://capacitorjs.com). Normalmente você não
  edita nada aqui direto — ele é regenerado a partir de `www/` com `npx cap sync android`.
- `.github/workflows/build-apk.yml` — compila o `.apk` automaticamente a cada push.

## Compilar o APK

Você **não precisa instalar nada** — todo push na branch `main` dispara o workflow do GitHub Actions,
que compila o app e disponibiliza o `.apk`:

1. Vá na aba **Actions** do repositório.
2. Abra a execução mais recente (ou espere a de um novo push terminar, ~3–5 min).
3. Baixe o artifact `pontofacil-app-debug`, ou pegue o `.apk` anexado na aba **Releases**
   (criada automaticamente a cada push na `main`).
4. Transfira o `.apk` pro celular Android e instale (é preciso permitir "instalar apps de fontes
   desconhecidas" nas configurações do Android — isso só aparece porque o app não veio da Play Store,
   é normal para instalação manual/interna).

Este é um **APK de debug**, não assinado para publicação na Play Store — serve pra distribuição interna
(instalação manual em cada celular). Se no futuro vocês quiserem publicar na Play Store, é preciso gerar
uma chave de assinatura de release — avise que eu ajudo com esse passo.

## Desenvolvimento local (opcional)

Se quiser rodar/editar localmente:

```bash
npm install
npx cap sync android      # depois de qualquer mudança em www/
npx cap open android      # abre no Android Studio (se tiver instalado)
```

## Backend (servidor)

O app conversa com os mesmos endpoints já usados pelo quiosque web
(`/var/www/html/ponto/api/*.php`). Duas mudanças foram feitas no servidor pra suportar o app:

- **CORS restrito à origem do app** (`https://localhost`, a origem padrão do WebView do Capacitor) nos
  4 endpoints usados: `registrar_ponto.php`, `get_descriptors.php`, `buscar_funcionario.php`,
  `get_ponto.php`.
- **`registrar_ponto.php`** aceita `data`/`hora` opcionais no corpo da requisição — usados quando um
  ponto foi batido offline e está sendo sincronizado depois, pra registrar a hora real em que aconteceu
  (não a hora em que a sincronização chegou no servidor). Se esses campos não forem enviados (como no
  quiosque web atual), o comportamento não muda.

## Multi-empresa: diretório central

`https://kallahari.com.br/ponto-directory/` é um serviço pequeno e separado (banco SQLite próprio) que
mapeia `código da empresa → URL da API daquela empresa`:

- `resolver.php?codigo=XXXXXX` — usado pelo app pra descobrir o endereço do servidor. Sem autenticação
  (é só leitura, não expõe nada sensível).
- `registrar.php` — usado pelo painel **Configurações > Módulo Web** de cada instalação (servidor a
  servidor, nunca pelo navegador) pra criar/atualizar sua própria entrada. Protegido por um token gerado
  junto com o código — só quem tem acesso ao painel daquela empresa consegue atualizar a URL registrada
  para o código dela.

## Atualização OTA (sem gerar um APK novo pra cada correção)

`app.js` e `styles.css` (a lógica e o visual do app) podem ser atualizados **sem reinstalar o APK** —
o app confere uma atualização assinada digitalmente toda vez que abre com internet, e aplica na
próxima abertura seguinte.

**Por que é assinado**: sem isso, qualquer um com acesso de escrita a
`/var/www/html/ponto-directory/app-update/` (nem que seja através de uma falha em *outro* sistema
hospedado no mesmo servidor, não necessariamente o Ponto) conseguiria fazer todo celular com o app
instalado rodar código arbitrário. Com a assinatura, só quem tem a **chave privada** — que não fica no
servidor nem neste repositório, só na máquina de quem publica — consegue gerar uma atualização que o
app aceita. Se os arquivos forem alterados sem a assinatura correspondente, o app rejeita e continua
com a versão anterior.

**Publicar uma atualização** (depois de editar `www/app.js` e/ou `www/styles.css`):

```bash
node scripts/publicar-atualizacao.js <numero-da-versao>
```

Isso gera `scripts/saida-publicacao/{app.js,styles.css,manifest.json}` (o `manifest.json` já vem com a
assinatura). Envie os 3 arquivos para `/var/www/html/ponto-directory/app-update/` no servidor
(sobrescrevendo os anteriores). O número da versão precisa ser sempre **maior** que o da publicação
anterior.

**A chave de assinatura** vive em `C:/Users/AUGUSTO/pontofacil-signing-key/` (fora deste repositório,
nunca commitada). Se essa pasta for perdida, não tem como recuperar — seria preciso gerar um par de
chaves novo, atualizar a chave pública em `www/loader.js` e lançar um APK novo (só esse arquivo em
si — `loader.js` — não é atualizável via OTA, de propósito, já que ele é quem confere a assinatura).

**Limitação importante**: só `app.js`/`styles.css` são atualizáveis assim. Mudanças em `index.html`
(novas telas/elementos) ou qualquer coisa nativa (novas permissões, novos plugins do Capacitor) ainda
exigem gerar um APK novo pelo GitHub Actions, como antes.
