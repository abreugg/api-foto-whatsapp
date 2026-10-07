# Atualização da VPS com banco existente

Esta atualização adiciona migrations versionadas. Não recrie o banco e não remova seu volume MySQL. Mantenha o `.env`, o `APP_SECRET` e o mesmo diretório/nome do projeto Compose que já está em produção.

## Migrations incluídas

- `001_initial.sql`: schema original, com `CREATE TABLE IF NOT EXISTS`. Pode ser executado sobre a instalação antiga sem apagar os dados.
- `002_missing_photos.sql`: tabela de cache para resultados não encontrados.
- `003_deleted_connections.sql`: registro de conexões excluídas, preservando os vínculos com fotos e histórico.

As duas tabelas novas também usam `IF NOT EXISTS`, por isso versões anteriores que já as criaram podem receber esta atualização. A tabela `schema_migrations` registra nome, checksum e data de aplicação. Não edite migrations depois de aplicadas; adicione novos arquivos numerados. O checksum normaliza quebras de linha Windows/Linux.

## Atualização normal

Faça o backup habitual do banco e copie o código novo para o diretório atual da aplicação, preservando o `.env`. Execute nesse mesmo diretório:

```sh
docker compose up -d --build --no-deps api
docker compose logs --tail=100 api
docker compose exec api npm run migrate:status
```

Na inicialização, a API aplica as migrations pendentes antes de abrir a porta HTTP. Logs `mysql.migration` informam início e conclusão de cada arquivo mesmo em produção. O status deve indicar as três migrations como `applied`. Depois confira `/health` e o painel `/admin` com Ctrl+F5.

## Executar a migration antes de substituir a API

Com o MySQL atual já ativo, é possível aplicar primeiro as alterações aditivas:

```sh
docker compose build api
docker compose run --rm --no-deps api npm run migrate:status
docker compose run --rm --no-deps api npm run migrate
docker compose up -d --no-deps api
```

Os comandos usam as credenciais da aplicação configuradas no Compose. Não exigem expor a senha root. O status cria o registro `schema_migrations` caso ainda não exista, mas não executa as migrations pendentes.

## Execução fora do Docker

Com o `.env` apontando para o MySQL existente:

```sh
npm run migrate:status
npm run migrate
```

## Falha ou execução interrompida

O runner usa um lock MySQL em uma conexão dedicada para impedir duas execuções simultâneas. DDL MySQL faz commit implícito: uma migration só é registrada depois que todos os seus comandos terminam. Os arquivos desta entrega são idempotentes e podem ser retomados após interrupção.

Se falhar, a API não aceita requisições com schema incompleto. Confira os logs e corrija conectividade/permissões antes de repetir. Não remova o registro de migrations para contornar um checksum diferente; restaure o arquivo original e crie outra migration quando precisar alterar o schema. As alterações desta entrega apenas criam tabelas e não oferecem rollback automático.
