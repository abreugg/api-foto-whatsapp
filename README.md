# FotoAPI

API de consulta de fotos de perfil do WhatsApp, com **ExpressJS**, **MySQL 8.4**, painel em **`/admin`** e integração com a **WUZAPI** descrita no YAML fornecido.

## Iniciar com Docker

Pré-requisito: Docker Engine/Desktop com Docker Compose. A WUZAPI deve estar em execução e acessível a partir do contêiner.

```powershell
Copy-Item .env.example .env
```

Preencha as cinco credenciais: `ADMIN_API_KEY`, `APP_SECRET`, `WUZAPI_ADMIN_TOKEN`, `MYSQL_PASSWORD` e `MYSQL_ROOT_PASSWORD`. Configure `WUZAPI_URL` e `PUBLIC_URL` conforme o ambiente.

Para gerar um segredo aleatório de 64 caracteres, execute este comando uma vez para cada chave/senha local:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

O `WUZAPI_ADMIN_TOKEN` deve ser o token administrativo já configurado na WUZAPI.

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

Abra **http://localhost:3000/admin/** e entre com `ADMIN_API_KEY`. O painel cria uma sessão de oito horas em cookie HttpOnly. A chave não é armazenada em localStorage ou sessionStorage.

O Compose sobe MySQL e a aplicação. O MySQL tem volume persistente `mysql_data` e não publica a porta do banco. A aplicação espera o banco ficar saudável e cria as tabelas automaticamente. O contêiner da aplicação usa usu…3166 tokens truncated… e URLs de diagnóstico não contêm query strings. Em produção, esses logs detalhados ficam desativados; erros internos mínimos e mensagens de inicialização continuam visíveis.

O erro em `/api/admin/connections` pode ocorrer depois de a autenticação local ter sido aceita. Essa rota precisa alcançar `WUZAPI_URL/admin/users` usando o token administrativo da WUZAPI.

Depois de alterar `.env` ou o código, recrie a aplicação e execute o diagnóstico dentro do contêiner:

```sh
docker compose up -d --build api
docker compose exec api npm run diagnose:wuzapi
```

Fora do Docker: `npm run diagnose:wuzapi`. O comando não imprime tokens nem dados das contas; informa sucesso, quantidade de conexões ou a causa da falha.

Timeout indica que o servidor não respondeu dentro do prazo. Confira a URL e porta corretas, se a WUZAPI está ativa, se escuta em uma interface acessível e se a porta está publicada/liberada para o servidor da aplicação. Conexão recusada indica que o destino rejeitou a conexão; DNS indica host não resolvido; HTTP 401/403 indica token rejeitado. Resposta HTML ou redirecionamento geralmente exige corrigir a URL base ou o proxy. Dentro do contêiner, `localhost` é o próprio contêiner da FotoAPI.

## Organização do projeto

```text
src/
  config/          # Configuração validada do ambiente
  database/        # Pool MySQL e inicialização do schema
  middlewares/     # Autenticação, CSRF, rate limit e headers
  repositories/    # SQL e persistência
  routes/          # Contratos HTTP do Express
  services/        # WUZAPI, conexões, imagens, cache e histórico
  utils/           # Validação, criptografia e erros
  app.js           # Composição da aplicação, sem abrir porta
  server.js        # Inicialização e encerramento
public/admin/      # HTML, CSS e JavaScript do painel
database/migrations/
test/              # Testes HTTP/serviços e integração MySQL
scripts/           # Checagem de sintaxe
```

JavaScript ESM, Node 24+, Express 5, queries parametrizadas e dependências fixadas em `package-lock.json`. O schema é novo: o ZIP fornecido não incluía um dump do banco antigo, por isso não há importação automática das tabelas legadas.

## Executar e testar fora do Docker

Configure `MYSQL_HOST`, credenciais e banco existente no `.env`. O usuário MySQL precisa criar tabelas no schema configurado.

```sh
npm ci
npm run check
npm test
npm start
```

`npm test` usa um repositório em memória apenas como dublê de teste e respostas simuladas da WUZAPI. Produção utiliza exclusivamente MySQL. O teste de banco real é separado:

```sh
# Banco MySQL de teste acessível no .env
npm run test:mysql
# Ou dentro do contêiner da API, que já recebe as variáveis:
# o teste não é copiado para a imagem de produção; rode em um ambiente de desenvolvimento.
```

Formatação: `npm run format` e `npm run format:check`.

## Configurações e documentação

Em `/admin`, a validade do cache usa um valor e uma unidade: meses, dias, horas, minutos ou segundos. Um mês equivale a 30 dias; zero desativa o cache. O botão **Excluir do cache** fica ao lado da foto nos resultados e no histórico. Ele força uma nova busca para o número, preservando fotos arquivadas e registros anteriores.

A aba **Documentação** contém apenas POST /api/photos e GET /api/photos/:phone, com autenticação, parâmetros, body e exemplos de resposta. O POST usa X-Api-Key no header; o GET aceita ?apikey=SUA_API_KEY. O botão **Baixar guia para IA (.md)** exporta [INTEGRATION_IA.md](docs/INTEGRATION_IA.md), com instruções e exemplos para integrar a plataforma. O download exige autenticação administrativa.

O catálogo compartilhado fica em `public/admin/api-reference.json`. Após alterar rotas ou exemplos, atualize o catálogo e execute `npm run docs:generate` para regenerar o guia a partir dele e de `docs/INTEGRATION_TEMPLATE.md`.

## Operação e próximos passos

O Compose foi projetado para **uma instância da API**. Rate limits, coordenação de consultas simultâneas e seleção de rotação têm estado no processo; reiniciar a API limpa os contadores de rate limit. Para múltiplas réplicas, adicione Redis para contadores e locks distribuídos antes de escalar.

Sugestões para operação contínua: backups periódicos do MySQL e `APP_SECRET`, política configurável de retenção das fotos e alertas para sessões desconectadas. A versão atual preserva todo o histórico até uma limpeza deliberada do banco.

Integração implementada conforme `spec.yml` fornecido: `/admin/users`, `/user/avatar` e `/session/*`. Referências das bibliotecas: [Express](https://expressjs.com/en/guide/routing/), [MySQL2](https://sidorares.github.io/node-mysql2/docs), [express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration).

## Cache de resultados não encontrados

Resultados sem foto também são guardados no MySQL com o mesmo TTL das fotos. Enquanto válidos, retornam HTTP 404 com `cacheHit: true`, sem consultar novamente a WUZAPI. Cada acesso gera histórico. TTL zero desativa ambos os caches; **Excluir do cache** também funciona para resultados não encontrados. As métricas de cache válido incluem os dois tipos, enquanto fotos arquivadas contam apenas imagens. Falhas temporárias não entram nesse cache. A tabela `missing_photos` é criada automaticamente ao iniciar a API, inclusive em bancos existentes; não apague o volume MySQL.
