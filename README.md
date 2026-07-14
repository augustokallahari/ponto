# PontoFácil — App Android (self-service, offline-first)

App Android para os funcionários baterem o próprio ponto pelo celular, com reconhecimento facial e
GPS, funcionando **offline** e sincronizando automaticamente com o servidor
(`https://kallahari.com.br/ponto`) assim que a conexão voltar.

## Como funciona

1. **Primeira vez**: o funcionário busca o próprio nome (precisa estar online), confirma quem é, e o
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
